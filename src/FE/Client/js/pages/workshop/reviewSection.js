import { reviewApi } from '../../api/reviewApi.js';
import { session } from '../../services/session.js';
import { escapeHtml } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';

/**
 * Standalone review widget for a case. Self-contained: nothing else needs to change to use it.
 *
 *   import { renderReviewSection } from './pages/workshop/reviewSection.js';
 *   renderReviewSection(caseId, document.querySelector('#review-mount'));
 *
 * It fetches summary + eligibility + the first page of reviews in parallel and renders them into
 * `mountElement`. The eligibility gate is re-enforced on the server; the form here is just UX.
 */

const SUB_FIELDS = [
  { key: 'difficulty', label: 'Độ khó' },
  { key: 'fairness', label: 'Công bằng' },
  { key: 'story', label: 'Cốt truyện' },
  { key: 'twist', label: 'Twist' },
];

const PAGE_SIZE = 5;
const MAX_TEXT = 2000;

export async function renderReviewSection(caseId, mountElement) {
  if (!mountElement) return;

  const state = {
    caseId,
    mount: mountElement,
    page: 1,
    items: [],
    total: 0,
    hasMore: false,
    summary: null,
    eligibility: null,
    draft: emptyDraft(),
  };

  mountElement.classList.add('ws-review');
  mountElement.innerHTML = '<p class="ws-review-loading">Đang tải đánh giá…</p>';

  try {
    await loadAll(state);
  } catch (err) {
    mountElement.innerHTML = `<p class="ws-review-error">${escapeHtml(err.message || 'Không tải được đánh giá.')}</p>`;
    return;
  }

  renderSection(state);
}

function emptyDraft() {
  return { rating: 0, difficulty: 0, fairness: 0, story: 0, twist: 0, reviewText: '', containsSpoiler: false };
}

async function loadAll(state) {
  const wantsEligibility = session.isLoggedIn();
  const [summary, list, eligibility] = await Promise.all([
    reviewApi.summary(state.caseId),
    reviewApi.list(state.caseId, 1, PAGE_SIZE),
    wantsEligibility ? reviewApi.eligibility(state.caseId) : Promise.resolve(null),
  ]);

  state.summary = summary;
  state.items = list.items || [];
  state.total = list.total || 0;
  state.hasMore = Boolean(list.hasMore);
  state.page = list.page || 1;
  state.eligibility = eligibility;
  state.draft = draftFromExisting(eligibility);
}

function draftFromExisting(eligibility) {
  const existing = eligibility?.existingReview;
  if (!existing) return emptyDraft();
  return {
    rating: existing.rating || 0,
    difficulty: existing.difficulty || 0,
    fairness: existing.fairness || 0,
    story: existing.story || 0,
    twist: existing.twist || 0,
    reviewText: existing.reviewText || '',
    containsSpoiler: Boolean(existing.containsSpoiler),
  };
}

/* --------------------------------- render -------------------------------- */

function renderSection(state) {
  state.mount.innerHTML = `
    <section class="ws-review-panel">
      ${summaryHtml(state.summary)}
      ${writeAreaHtml(state)}
      <div class="ws-review-list">
        <h4 class="ws-review-subtitle">Tất cả đánh giá (${state.total})</h4>
        <div class="ws-review-items">${state.items.map(reviewItemHtml).join('') || emptyItemsHtml()}</div>
        ${state.hasMore ? '<button class="ws-review-more" type="button">Tải thêm</button>' : ''}
      </div>
    </section>`;

  wireEvents(state);
}

function summaryHtml(summary) {
  const avg = summary?.avgRating || 0;
  const total = summary?.totalReviews || 0;
  const bars = SUB_FIELDS.map((f) => subBarHtml(f.label, summary?.[`avg${cap(f.key)}`])).join('');
  return `
    <div class="ws-review-summary">
      <div class="ws-review-score">
        <span class="ws-review-score-num">${avg ? avg.toFixed(1) : '–'}</span>
        <span class="ws-review-stars" aria-hidden="true">${starsHtml(Math.round(avg))}</span>
        <span class="ws-review-count">${total} đánh giá</span>
      </div>
      <div class="ws-review-bars">${bars}</div>
    </div>`;
}

function subBarHtml(label, value) {
  const pct = value ? Math.max(0, Math.min(100, (value / 5) * 100)) : 0;
  return `
    <div class="ws-review-bar-row">
      <span class="ws-review-bar-label">${escapeHtml(label)}</span>
      <span class="ws-review-bar-track"><span class="ws-review-bar-fill" style="width:${pct}%"></span></span>
      <span class="ws-review-bar-val">${value ? value.toFixed(1) : '–'}</span>
    </div>`;
}

function writeAreaHtml(state) {
  if (!session.isLoggedIn()) {
    return `<div class="ws-review-notice">Đăng nhập để viết đánh giá. <a class="ws-review-link" href="#/login">Đăng nhập</a></div>`;
  }

  const reason = state.eligibility?.reason;
  if (reason === 'NOT_PLAYED') {
    return `
      <div class="ws-review-notice">
        <p>Phải phá án xong mới đánh giá được.</p>
        <a class="ws-review-link" href="#/cases/${encodeURIComponent(state.caseId)}">Đi phá án</a>
      </div>`;
  }
  if (reason === 'OWN_CASE') {
    return `<div class="ws-review-notice">Không thể đánh giá case do chính bạn tạo.</div>`;
  }

  const isEdit = reason === 'ALREADY_REVIEWED';
  const d = state.draft;
  return `
    <form class="ws-review-form" novalidate>
      <h4 class="ws-review-subtitle">${isEdit ? 'Cập nhật đánh giá của bạn' : 'Viết đánh giá'}</h4>
      <div class="ws-review-field">
        <label class="ws-review-field-label">Tổng quan *</label>
        ${starInputHtml('rating', d.rating)}
      </div>
      <div class="ws-review-sub-grid">
        ${SUB_FIELDS.map((f) => `
          <div class="ws-review-field">
            <label class="ws-review-field-label">${escapeHtml(f.label)}</label>
            ${starInputHtml(f.key, d[f.key])}
          </div>`).join('')}
      </div>
      <div class="ws-review-field">
        <label class="ws-review-field-label" for="ws-review-text">Nhận xét</label>
        <textarea id="ws-review-text" class="ws-review-text" maxlength="${MAX_TEXT}" rows="4"
          placeholder="Cảm nhận của bạn về vụ án…">${escapeHtml(d.reviewText)}</textarea>
      </div>
      <label class="ws-review-checkbox">
        <input type="checkbox" name="containsSpoiler" ${d.containsSpoiler ? 'checked' : ''}>
        <span>Đánh giá này có tiết lộ tình tiết</span>
      </label>
      <button class="ws-review-submit" type="submit">${isEdit ? 'Cập nhật' : 'Gửi đánh giá'}</button>
    </form>`;
}

function starInputHtml(field, value) {
  const stars = [1, 2, 3, 4, 5].map((n) => `
    <button type="button" class="ws-review-star-btn ${n <= value ? 'is-on' : ''}"
      data-field="${field}" data-value="${n}" aria-label="${n} sao">${n <= value ? '★' : '☆'}</button>`).join('');
  const clear = field === 'rating'
    ? ''
    : `<button type="button" class="ws-review-star-clear" data-field="${field}" data-value="0" title="Bỏ chọn">×</button>`;
  return `<span class="ws-review-star-input" data-field-group="${field}">${stars}${clear}</span>`;
}

function reviewItemHtml(item) {
  const badge = item.resultLabel === 'SOLVED'
    ? '<span class="ws-review-badge ws-review-badge-solved">✅ Đã phá án</span>'
    : '<span class="ws-review-badge ws-review-badge-wrong">❌ Buộc tội sai</span>';

  const body = item.reviewText
    ? (item.containsSpoiler
        ? `<div class="ws-review-spoiler is-hidden">
             <p class="ws-review-item-text">${escapeHtml(item.reviewText)}</p>
             <button type="button" class="ws-review-reveal">Hiện tình tiết</button>
           </div>`
        : `<p class="ws-review-item-text">${escapeHtml(item.reviewText)}</p>`)
    : '';

  return `
    <article class="ws-review-item">
      <header class="ws-review-item-head">
        <span class="ws-review-item-author">${escapeHtml(item.authorDisplay || 'Thám tử ẩn danh')}</span>
        <span class="ws-review-stars ws-review-item-stars" aria-label="${item.rating} sao">${starsHtml(item.rating)}</span>
        ${badge}
      </header>
      ${body}
    </article>`;
}

function emptyItemsHtml() {
  return '<p class="ws-review-empty">Chưa có đánh giá nào. Hãy là người đầu tiên!</p>';
}

/* --------------------------------- events -------------------------------- */

function wireEvents(state) {
  const root = state.mount;

  // Star pickers (overall + optional sub-ratings) and clear buttons.
  root.querySelectorAll('.ws-review-star-btn, .ws-review-star-clear').forEach((btn) => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      state.draft[field] = Number(btn.dataset.value);
      refreshStarGroup(root, field, state.draft[field]);
    });
  });

  const text = root.querySelector('#ws-review-text');
  if (text) text.addEventListener('input', () => { state.draft.reviewText = text.value; });

  const spoiler = root.querySelector('input[name="containsSpoiler"]');
  if (spoiler) spoiler.addEventListener('change', () => { state.draft.containsSpoiler = spoiler.checked; });

  const form = root.querySelector('.ws-review-form');
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); submit(state, form); });

  root.querySelectorAll('.ws-review-reveal').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.ws-review-spoiler')?.classList.remove('is-hidden'));
  });

  const more = root.querySelector('.ws-review-more');
  if (more) more.addEventListener('click', () => loadMore(state, more));
}

function refreshStarGroup(root, field, value) {
  const group = root.querySelector(`[data-field-group="${field}"]`);
  if (!group) return;
  group.querySelectorAll('.ws-review-star-btn').forEach((btn) => {
    const on = Number(btn.dataset.value) <= value;
    btn.classList.toggle('is-on', on);
    btn.textContent = on ? '★' : '☆';
  });
}

async function submit(state, form) {
  if (!state.draft.rating) {
    toast('Hãy chọn số sao tổng quan.', 'error');
    return;
  }

  const button = form.querySelector('.ws-review-submit');
  button.disabled = true;
  const payload = {
    rating: state.draft.rating,
    difficulty: state.draft.difficulty || null,
    fairness: state.draft.fairness || null,
    story: state.draft.story || null,
    twist: state.draft.twist || null,
    reviewText: state.draft.reviewText,
    containsSpoiler: state.draft.containsSpoiler,
  };

  try {
    await reviewApi.submit(state.caseId, payload);
    toast('Đã lưu đánh giá của bạn.', 'success');
    await loadAll(state);
    renderSection(state);
  } catch (err) {
    toast(err.message || 'Không gửi được đánh giá.', 'error');
    button.disabled = false;
  }
}

async function loadMore(state, button) {
  button.disabled = true;
  try {
    const next = await reviewApi.list(state.caseId, state.page + 1, PAGE_SIZE);
    state.items = state.items.concat(next.items || []);
    state.page = next.page || state.page + 1;
    state.hasMore = Boolean(next.hasMore);
    renderSection(state);
  } catch (err) {
    toast(err.message || 'Không tải thêm được.', 'error');
    button.disabled = false;
  }
}

/* --------------------------------- helpers ------------------------------- */

function starsHtml(value) {
  const v = Math.max(0, Math.min(5, value || 0));
  return '★'.repeat(v) + '☆'.repeat(5 - v);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
