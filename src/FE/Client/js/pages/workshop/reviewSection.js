import '../../../../css/34-bpa-workshop.css';
import { reviewApi } from '../../api/reviewApi.js';
import { session } from '../../services/session.js';
import { escapeHtml, initials } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';
import { tr, plural, uiLanguage } from '../../services/i18n.js';
import { fmtDate, fmtInt } from './caseOfWeekBanner.js';

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
  { key: 'difficulty', label: () => tr('Difficulty', 'Độ khó') },
  { key: 'fairness', label: () => tr('Fairness', 'Công bằng') },
  { key: 'story', label: () => tr('Story', 'Cốt truyện') },
  { key: 'twist', label: () => tr('Twist', 'Twist') },
];

const PAGE_SIZE = 5;
const MAX_TEXT = 2000;
const STAR_PATH = 'M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96z';

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
    // Presentation-only state (saved stamp, rating error, revealed spoilers, form animation flip).
    ui: { saved: false, err: false, flip: null, revealed: new Set() },
  };

  mountElement.classList.add('bpa-wsc-rvmount');
  mountElement.innerHTML = `<p class="bpa-wsc-loading" role="status">${tr('Loading reviews…', 'Đang tải đánh giá…')}</p>`;

  try {
    await loadAll(state);
  } catch (err) {
    mountElement.innerHTML = `<p class="bpa-wsc-error" role="status">${escapeHtml(err.message || tr('Could not load reviews.', 'Không tải được đánh giá.'))}</p>`;
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
  const total = fmtInt(state.total);
  state.mount.innerHTML = `
    <div class="bpa-wsc-rev">
      <div class="bpa-wsc-revside">
        ${summaryHtml(state.summary)}
        ${writeAreaHtml(state)}
      </div>
      <section class="bpa-wsc-revlist" aria-labelledby="wsc-all-h">
        <div class="bpa-wsc-listhead">
          <h3 id="wsc-all-h" class="bpa-wsc-h3">${tr(`All reviews (${total})`, `Tất cả đánh giá (${total})`)}</h3>
          ${state.items.length ? `<span class="bpa-wsc-mini">${tr('Newest first', 'Mới nhất trước')}</span>` : ''}
        </div>
        ${state.items.length
          ? `<ul class="bpa-wsc-list">${state.items.map((item, i) => reviewItemHtml(item, i, state)).join('')}</ul>`
          : emptyItemsHtml()}
        ${state.items.length ? `
          <div class="bpa-wsc-morebar">
            ${state.hasMore ? `
              <button class="bpa-btn bpa-btn--ink bpa-wsc-more" type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
                <span>${tr('Load more', 'Tải thêm')}</span>
              </button>` : ''}
            <span class="bpa-wsc-mini" aria-live="polite">${tr(
              `Showing ${fmtInt(state.items.length)} / ${total}`,
              `Đang hiển thị ${fmtInt(state.items.length)} / ${total}`,
            )}</span>
          </div>` : ''}
      </section>
    </div>`;

  wireEvents(state);
}

function summaryHtml(summary) {
  const avg = summary?.avgRating || 0;
  const total = summary?.totalReviews || 0;
  const crit = SUB_FIELDS
    .map((f) => ({ f, value: summary?.[`avg${cap(f.key)}`] }))
    .filter((c) => c.value);
  return `
    <section class="bpa-wsc-sum" aria-labelledby="wsc-sum-h">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <p class="bpa-kicker bpa-wsc-kick bpa-wsc-kick--gold">${tr('Community score', 'Điểm cộng đồng')}</p>
      <h3 id="wsc-sum-h" class="bpa-wsc-h3 bpa-wsc-h3--light">${tr('Overview', 'Tổng quan')}</h3>
      <div class="bpa-wsc-sumtop">
        <p class="bpa-wsc-sumbig"><span class="bpa-sr">${tr('Overall score', 'Điểm tổng quan')} </span>${avg ? fmt1(avg) : '–'}</p>
        <div>
          ${starsHtml(avg, 'gold', avg ? tr(`${fmt1(avg)} out of 5 stars`, `${fmt1(avg)} trên 5 sao`) : tr('No rating yet', 'Chưa có điểm'))}
          <p class="bpa-wsc-sumsub">${tr(
            `out of 5 · ${fmtInt(total)} ${plural(total, 'review', 'reviews')}`,
            `trên 5 · ${fmtInt(total)} đánh giá`,
          )}</p>
        </div>
      </div>
      ${crit.length ? `
        <dl class="bpa-wsc-crit">
          ${crit.map(({ f, value }) => `
            <div>
              <dt>${escapeHtml(f.label())}</dt>
              <dd class="bpa-wsc-cm" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, (value / 5) * 100))}%"></span></dd>
              <dd class="bpa-wsc-cv">${fmt1(value)}</dd>
            </div>`).join('')}
        </dl>` : ''}
    </section>`;
}

function noticeHtml(body) {
  return `
    <section class="bpa-wsc-form bpa-wsc-form--notice" aria-labelledby="wsc-form-h">
      <span class="bpa-wsc-margin" aria-hidden="true"></span>
      <span class="bpa-pin" aria-hidden="true"></span>
      <p class="bpa-kicker bpa-wsc-kick">${tr('Review slip', 'Phiếu nhận xét')}</p>
      <h3 id="wsc-form-h" class="bpa-wsc-h3">${tr('Write a review', 'Viết đánh giá')}</h3>
      <div class="bpa-wsc-notice" role="status">${body}</div>
    </section>`;
}

function writeAreaHtml(state) {
  if (!session.isLoggedIn()) {
    return noticeHtml(`
      <p>${tr('Sign in to write a review.', 'Đăng nhập để viết đánh giá.')}</p>
      <a class="bpa-btn bpa-btn--ink" href="#/login">${tr('Sign in', 'Đăng nhập')}</a>`);
  }

  const reason = state.eligibility?.reason;
  if (reason === 'NOT_PLAYED') {
    return noticeHtml(`
      <p>${tr('Solve the case first to review it.', 'Phải phá án xong mới đánh giá được.')}</p>
      <a class="bpa-btn bpa-btn--ink" href="#/cases/${encodeURIComponent(state.caseId)}">${tr('Go solve it', 'Đi phá án')}</a>`);
  }
  if (reason === 'OWN_CASE') {
    return noticeHtml(`<p>${tr('You cannot review a case you created.', 'Không thể đánh giá case do chính bạn tạo.')}</p>`);
  }

  const isEdit = reason === 'ALREADY_REVIEWED';
  const d = state.draft;
  const ui = state.ui;
  const flash = ui.flip === null ? '' : (ui.flip ? ' bpa-wsc-fb' : ' bpa-wsc-fa');
  return `
    <section class="bpa-wsc-form${flash}" aria-labelledby="wsc-form-h">
      <span class="bpa-wsc-margin" aria-hidden="true"></span>
      <span class="bpa-pin" aria-hidden="true"></span>
      ${ui.saved ? `<span class="bpa-stamp bpa-stamp--teal bpa-wsc-fstamp" aria-hidden="true">${tr('Saved', 'Đã lưu')}</span>` : ''}
      <p class="bpa-kicker bpa-wsc-kick">${tr('Review slip', 'Phiếu nhận xét')}</p>
      <h3 id="wsc-form-h" class="bpa-wsc-h3">${isEdit ? tr('Update your review', 'Cập nhật đánh giá của bạn') : tr('Write a review', 'Viết đánh giá')}</h3>
      <form class="bpa-wsc-rvform" novalidate>
        <div class="bpa-wsc-ovrow${ui.err ? ' is-err' : ''}" data-ovrow>
          <div class="bpa-wsc-ovtop">
            <span id="wsc-rate-rating-l" class="bpa-wsc-flabel">${tr('Overall', 'Tổng quan')} <span class="bpa-wsc-req" aria-hidden="true">*</span></span>
            <span class="bpa-wsc-rval" data-rval="rating" aria-hidden="true">${rvalText(d.rating)}</span>
          </div>
          ${starInputHtml('rating', d.rating, { big: true, invalid: ui.err })}
        </div>
        <div class="bpa-wsc-crits">
          ${SUB_FIELDS.map((f) => `
            <div class="bpa-wsc-frow">
              <span id="wsc-rate-${f.key}-l" class="bpa-wsc-flabel">${escapeHtml(f.label())}</span>
              ${starInputHtml(f.key, d[f.key], { name: f.label() })}
            </div>`).join('')}
        </div>
        <div class="bpa-wsc-field">
          <div class="bpa-wsc-frow bpa-wsc-frow--plain">
            <label class="bpa-wsc-flabel" for="ws-review-text">${tr('Comment', 'Nhận xét')}</label>
            <span class="bpa-wsc-mini" data-count aria-hidden="true">${d.reviewText.length}/${MAX_TEXT}</span>
          </div>
          <textarea id="ws-review-text" class="bpa-wsc-note" maxlength="${MAX_TEXT}" rows="3"
            placeholder="${tr('What made the case memorable? Don’t name the culprit.', 'Điều gì khiến vụ án đáng nhớ? Đừng nêu tên thủ phạm.')}">${escapeHtml(d.reviewText)}</textarea>
        </div>
        <label class="bpa-wsc-check">
          <input type="checkbox" name="containsSpoiler" ${d.containsSpoiler ? 'checked' : ''}>
          <span>${tr('This review reveals plot details', 'Đánh giá này có tiết lộ tình tiết')}</span>
        </label>
        <p class="bpa-wsc-hint" data-spoil-hint ${d.containsSpoiler ? '' : 'hidden'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.2A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.8 0 3.3-.5 4.6-1.2"/></svg>
          <span>${tr('The comment stays blurred until a reader chooses “Show details”.', 'Nhận xét sẽ được làm mờ cho tới khi người đọc chọn “Hiện tình tiết”.')}</span>
        </p>
        <div class="bpa-wsc-submit">
          <button class="bpa-btn bpa-btn--red bpa-wsc-submitbtn" type="submit">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 4.5l4 4L9 19l-5 1 1-5z"/><path d="M13 7l4 4"/></svg>
            <span>${isEdit ? tr('Update', 'Cập nhật') : tr('Submit review', 'Gửi đánh giá')}</span>
          </button>
          <div id="wsc-rv-status" class="bpa-wsc-status" role="status" aria-live="polite">${statusHtml(ui)}</div>
        </div>
      </form>
    </section>`;
}

function statusHtml(ui) {
  if (ui.err) {
    return `<p class="bpa-wsc-toast">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8a58c" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>
      ${tr('Pick an overall star rating.', 'Hãy chọn số sao tổng quan.')}</p>`;
  }
  if (ui.saved) {
    return `<p class="bpa-wsc-toast bpa-wsc-toast--ok">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8fd0cf" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/></svg>
      ${tr('Your review has been saved.', 'Đã lưu đánh giá của bạn.')}</p>`;
  }
  return '';
}

function rvalText(value) {
  return value ? `${value} / 5` : tr('Not set', 'Chưa chọn');
}

function starWord(n) {
  return tr(`${n} ${plural(n, 'star', 'stars')}`, `${n} sao`);
}

/** Star picker = a native radio group (arrow keys work), each label a 44px target. */
function starInputHtml(field, value, { big = false, invalid = false, name = '' } = {}) {
  const required = field === 'rating';
  const radios = [1, 2, 3, 4, 5].map((n) => `
    <input type="radio" class="bpa-wsc-rate-in" id="wsc-rate-${field}-${n}" name="wsc-rate-${field}" value="${n}"
      data-field="${field}" data-value="${n}" ${n === value ? 'checked' : ''}>
    <label for="wsc-rate-${field}-${n}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${STAR_PATH}"/></svg><span class="bpa-sr">${starWord(n)}</span></label>`).join('');
  const clear = required
    ? ''
    : `<button type="button" class="bpa-wsc-clear${value ? '' : ' is-off'}" data-field="${field}" data-value="0"
        aria-label="${escapeHtml(tr(`Clear ${name} rating`, `Bỏ chọn ${name}`))}" title="${tr('Clear', 'Bỏ chọn')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>
      </button>`;
  return `
    <div class="bpa-wsc-rateline">
      <div class="bpa-wsc-rate${big ? ' bpa-wsc-rate--big' : ''} is-v${value || 0}" role="radiogroup"
        aria-labelledby="wsc-rate-${field}-l" data-field-group="${field}"
        ${required ? `aria-required="true" aria-invalid="${invalid}" aria-describedby="wsc-rv-status"` : ''}>${radios}</div>
      ${clear}
    </div>`;
}

const ICON_OK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const ICON_BAD = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';

function reviewItemHtml(item, index, state) {
  const solved = item.resultLabel === 'SOLVED';
  const badge = solved
    ? `<span class="bpa-wsc-res bpa-wsc-res--ok">${ICON_OK}${tr('Solved', 'Đã phá án')}</span>`
    : `<span class="bpa-wsc-res bpa-wsc-res--bad">${ICON_BAD}${tr('Wrong accusation', 'Buộc tội sai')}</span>`;
  const anon = !item.authorDisplay;
  const name = item.authorDisplay || tr('Anonymous detective', 'Thám tử ẩn danh');
  const key = item.id || `i${index}`;
  const revealed = state.ui.revealed.has(key);
  const spoiler = Boolean(item.reviewText && item.containsSpoiler);

  const body = item.reviewText
    ? (spoiler
        ? `<div class="bpa-wsc-spoil${revealed ? '' : ' is-hidden'}">
             <p id="wsc-sp-${index}" class="bpa-wsc-rvtext"${revealed ? '' : ' aria-hidden="true"'}>${escapeHtml(item.reviewText)}</p>
             <div class="bpa-wsc-spcover"${revealed ? ' hidden' : ''}>
               <button type="button" class="bpa-btn bpa-btn--ink bpa-wsc-reveal" data-spoil-key="${escapeHtml(key)}"
                 aria-controls="wsc-sp-${index}" aria-expanded="false">
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
                 <span>${tr('Show details', 'Hiện tình tiết')}</span>
               </button>
             </div>
           </div>
           <button type="button" class="bpa-wsc-hidebtn" data-spoil-key="${escapeHtml(key)}" aria-controls="wsc-sp-${index}"
             aria-expanded="true"${revealed ? '' : ' hidden'}>${tr('Hide details', 'Ẩn tình tiết')}</button>`
        : `<p class="bpa-wsc-rvtext">${escapeHtml(item.reviewText)}</p>`)
    : '';

  const crit = SUB_FIELDS.filter((f) => item[f.key]).map((f) =>
    `<span>${escapeHtml(f.label())} <b>${item[f.key]}</b></span>`).join('');
  const date = fmtDate(item.createdAt);

  return `
    <li>
      <article class="bpa-wsc-rv" aria-labelledby="wsc-rv-${index}">
        <span class="bpa-wsc-margin" aria-hidden="true"></span>
        <span class="bpa-avatar bpa-wsc-ava${anon ? ' bpa-wsc-ava--anon' : ''}" aria-hidden="true">${anon ? '?' : escapeHtml(initials(name.replace(/[_.]+/g, ' ')))}</span>
        <div class="bpa-wsc-rvmain">
          <div class="bpa-wsc-rvhead">
            <div class="bpa-wsc-rvwho">
              <h4 id="wsc-rv-${index}" class="bpa-wsc-rvname${anon ? ' is-anon' : ''}">${escapeHtml(name)}</h4>
              ${badge}
              ${spoiler ? `<span class="bpa-wsc-res bpa-wsc-res--warn">${tr('Contains spoilers', 'Có tiết lộ tình tiết')}</span>` : ''}
            </div>
            <div class="bpa-wsc-rvmeta">
              ${starsHtml(item.rating, 'sm', tr(`${item.rating} out of 5 stars`, `${item.rating} trên 5 sao`))}
              ${date ? `<time class="bpa-wsc-mini" datetime="${escapeHtml(String(item.createdAt))}">${escapeHtml(date)}</time>` : ''}
            </div>
          </div>
          ${body}
          ${crit ? `<p class="bpa-wsc-rvcrit">${crit}</p>` : ''}
        </div>
      </article>
    </li>`;
}

function emptyItemsHtml() {
  return `<p class="bpa-wsc-empty">${tr('No reviews yet. Be the first!', 'Chưa có đánh giá nào. Hãy là người đầu tiên!')}</p>`;
}

/* --------------------------------- events -------------------------------- */

function wireEvents(state) {
  const root = state.mount;

  // Star pickers (overall + optional sub-ratings) and clear buttons.
  root.querySelectorAll('.bpa-wsc-rate-in').forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const field = input.dataset.field;
      state.draft[field] = Number(input.dataset.value);
      refreshStarGroup(root, field, state.draft[field]);
      if (field === 'rating' && state.ui.err) clearRatingError(state);
    });
  });
  root.querySelectorAll('.bpa-wsc-clear').forEach((btn) => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      state.draft[field] = Number(btn.dataset.value);
      refreshStarGroup(root, field, state.draft[field]);
      root.querySelector(`[data-field-group="${field}"] .bpa-wsc-rate-in`)?.focus();
    });
  });

  const text = root.querySelector('#ws-review-text');
  const count = root.querySelector('[data-count]');
  if (text) {
    text.addEventListener('input', () => {
      state.draft.reviewText = text.value;
      if (count) count.textContent = `${text.value.length}/${MAX_TEXT}`;
    });
  }

  const spoiler = root.querySelector('input[name="containsSpoiler"]');
  const hint = root.querySelector('[data-spoil-hint]');
  if (spoiler) {
    spoiler.addEventListener('change', () => {
      state.draft.containsSpoiler = spoiler.checked;
      if (hint) hint.hidden = !spoiler.checked;
    });
  }

  const form = root.querySelector('.bpa-wsc-rvform');
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); submit(state, form); });

  root.querySelectorAll('.bpa-wsc-reveal').forEach((btn) => {
    btn.addEventListener('click', () => setSpoiler(state, btn, true));
  });
  root.querySelectorAll('.bpa-wsc-hidebtn').forEach((btn) => {
    btn.addEventListener('click', () => setSpoiler(state, btn, false));
  });

  const more = root.querySelector('.bpa-wsc-more');
  if (more) more.addEventListener('click', () => loadMore(state, more));
}

function setSpoiler(state, btn, open) {
  const article = btn.closest('.bpa-wsc-rv');
  const box = article?.querySelector('.bpa-wsc-spoil');
  if (!box) return;
  const key = btn.dataset.spoilKey;
  if (open) state.ui.revealed.add(key); else state.ui.revealed.delete(key);
  box.classList.toggle('is-hidden', !open);
  const textEl = box.querySelector('.bpa-wsc-rvtext');
  if (open) textEl?.removeAttribute('aria-hidden'); else textEl?.setAttribute('aria-hidden', 'true');
  const cover = box.querySelector('.bpa-wsc-spcover');
  const hideBtn = article.querySelector('.bpa-wsc-hidebtn');
  if (cover) cover.hidden = open;
  if (hideBtn) hideBtn.hidden = !open;
  (open ? hideBtn : cover?.querySelector('.bpa-wsc-reveal'))?.focus();
}

function refreshStarGroup(root, field, value) {
  const group = root.querySelector(`[data-field-group="${field}"]`);
  if (!group) return;
  group.className = group.className.replace(/\bis-v\d\b/, `is-v${value || 0}`);
  group.querySelectorAll('.bpa-wsc-rate-in').forEach((input) => {
    input.checked = Number(input.dataset.value) === value;
  });
  const clear = group.parentElement?.querySelector('.bpa-wsc-clear');
  if (clear) clear.classList.toggle('is-off', !value);
  const rval = root.querySelector(`[data-rval="${field}"]`);
  if (rval) rval.textContent = rvalText(value);
}

function showRatingError(state, form) {
  state.ui.err = true;
  state.ui.saved = false;
  const row = form.querySelector('[data-ovrow]');
  const group = form.querySelector('[data-field-group="rating"]');
  const status = form.querySelector('#wsc-rv-status');
  const section = form.closest('.bpa-wsc-form');
  if (row) row.classList.add('is-err');
  if (group) group.setAttribute('aria-invalid', 'true');
  if (status) status.innerHTML = statusHtml(state.ui);
  if (section) {
    // Replay the shake / toast animation on every failed attempt.
    state.ui.flip = !state.ui.flip;
    section.classList.remove('bpa-wsc-fa', 'bpa-wsc-fb');
    void section.offsetWidth;
    section.classList.add(state.ui.flip ? 'bpa-wsc-fb' : 'bpa-wsc-fa');
    section.querySelector('.bpa-wsc-fstamp')?.remove();
  }
  form.querySelector('.bpa-wsc-rate-in')?.focus();
}

function clearRatingError(state) {
  state.ui.err = false;
  const root = state.mount;
  root.querySelector('[data-ovrow]')?.classList.remove('is-err');
  root.querySelector('[data-field-group="rating"]')?.setAttribute('aria-invalid', 'false');
  const status = root.querySelector('#wsc-rv-status');
  if (status) status.innerHTML = '';
}

async function submit(state, form) {
  if (!state.draft.rating) {
    toast(tr('Pick an overall star rating.', 'Hãy chọn số sao tổng quan.'), 'error');
    showRatingError(state, form);
    return;
  }

  const button = form.querySelector('.bpa-wsc-submitbtn');
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
    toast(tr('Your review has been saved.', 'Đã lưu đánh giá của bạn.'), 'success');
    await loadAll(state);
    state.ui.err = false;
    state.ui.saved = true;
    state.ui.flip = !state.ui.flip;
    renderSection(state);
  } catch (err) {
    toast(err.message || tr('Could not submit the review.', 'Không gửi được đánh giá.'), 'error');
    button.disabled = false;
  }
}

async function loadMore(state, button) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  const label = button.querySelector('span');
  if (label) label.textContent = tr('Loading…', 'Đang tải…');
  try {
    const next = await reviewApi.list(state.caseId, state.page + 1, PAGE_SIZE);
    state.items = state.items.concat(next.items || []);
    state.page = next.page || state.page + 1;
    state.hasMore = Boolean(next.hasMore);
    renderSection(state);
  } catch (err) {
    toast(err.message || tr('Could not load more.', 'Không tải thêm được.'), 'error');
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (label) label.textContent = tr('Load more', 'Tải thêm');
  }
}

/* --------------------------------- helpers ------------------------------- */

/** Five drawn stars; fractional values partly fill the last star. */
function starsHtml(value, variant, label) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  const star = (cls) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${STAR_PATH}"/></svg>`;
  const parts = [1, 2, 3, 4, 5].map((i) => {
    if (v >= i) return star('f');
    if (v > i - 1) {
      const pct = Math.round((v - (i - 1)) * 100);
      return `<span class="bpa-wsc-pstar" aria-hidden="true">${star('e')}<span class="bpa-wsc-pfill" style="width:${pct}%">${star('f')}</span></span>`;
    }
    return star('e');
  }).join('');
  return `<span class="bpa-wsc-stars${variant ? ` bpa-wsc-stars--${variant}` : ''}" role="img" aria-label="${escapeHtml(label)}">${parts}</span>`;
}

function fmt1(value) {
  return Number(value).toLocaleString(uiLanguage() === 'vi' ? 'vi-VN' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
