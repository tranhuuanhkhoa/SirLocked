import '../../../../css/34-bpa-workshop.css';
import { weeklyApi } from '../../api/weeklyApi.js';
import { escapeHtml, placeholderStyle } from '../../utils/dom.js';
import { tr, uiLanguage } from '../../services/i18n.js';

/**
 * Standalone "Case of the Week" banner. Self-contained:
 *
 *   import { renderCaseOfWeekBanner } from './pages/workshop/caseOfWeekBanner.js';
 *   renderCaseOfWeekBanner(document.querySelector('#cow-mount'));
 *
 * Renders nothing (and hides the mount) when no case of the week is active, so it never takes space.
 *
 * The module also exports the small presentation helpers shared by the Workshop pages
 * (cover art with the deterministic placeholder fallback, ISO week number, dates, counts).
 */
export async function renderCaseOfWeekBanner(mount) {
  if (!mount) return;

  let feature;
  try {
    feature = await weeklyApi.caseOfWeek();
  } catch {
    hide(mount); // non-critical banner; fail quietly
    return;
  }

  if (!feature) {
    hide(mount);
    return;
  }

  const id = encodeURIComponent(feature.caseId);
  const week = isoWeek(feature.weekStart);
  const range = dateRange(feature.weekStart, feature.weekEnd);
  mount.style.display = '';
  mount.classList.add('bpa-ws-cow');
  mount.innerHTML = `
    <section class="bpa-ws-banner" aria-labelledby="ws-cow-title">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <div class="bpa-ws-banner-media">${coverArtHtml(feature.caseId, feature.coverImageUrl)}</div>
      <div class="bpa-ws-banner-body">
        <div class="bpa-masthead bpa-ws-masthead">
          <span>${tr('221B GAZETTE · CASE OF THE WEEK', 'BÁO 221B · VỤ ÁN CỦA TUẦN')}</span>
          ${week ? `<span class="bpa-ws-masthead-week">${tr('WEEK', 'TUẦN')} ${week}</span>` : ''}
        </div>
        <h2 id="ws-cow-title" class="bpa-ws-banner-title">${escapeHtml(feature.caseTitle)}</h2>
        ${feature.summary ? `<p class="bpa-ws-banner-summary">${escapeHtml(feature.summary)}</p>` : ''}
        <div class="bpa-ws-chips">
          ${feature.estimatedMinutes ? `<span class="bpa-chip">${minutesLabel(feature.estimatedMinutes)}</span>` : ''}
          ${range ? `<span class="bpa-chip">${escapeHtml(range)}</span>` : ''}
        </div>
        <div class="bpa-ws-banner-cta">
          <a class="bpa-btn bpa-btn--red bpa-ws-banner-play" href="#/cases/${id}">${tr('Play now', 'Chơi ngay')}</a>
          <a class="bpa-btn bpa-btn--ink" href="#/workshop/${id}">${tr('Statistics', 'Thống kê')}</a>
        </div>
      </div>
    </section>`;
}

function hide(mount) {
  mount.innerHTML = '';
  mount.style.display = 'none';
}

/* ------------------------- shared presentation helpers ------------------------- */

/**
 * Cover art for a case: the data-provided image over the deterministic placeholder gradient,
 * with a neutral case-file emblem underneath (shown when there is no image or it fails to load).
 */
export function coverArtHtml(seed, url) {
  return `
    <span class="bpa-ws-art" style="${placeholderStyle(seed)}" aria-hidden="true">
      <svg class="bpa-ws-art-emblem" viewBox="0 0 380 130" preserveAspectRatio="xMidYMid meet" focusable="false">
        <g transform="translate(128 20) rotate(-4)">
          <rect width="124" height="88" rx="1" fill="#e9dcc0"/>
          <path d="M14 20H104M14 32H92M14 44H108M14 56H74" stroke="#8f8676" stroke-width="2"/>
          <path d="M14 70H60" stroke="#b8382b" stroke-width="1.6"/>
        </g>
        <circle cx="238" cy="94" r="17" fill="#b8382b"/>
        <circle cx="238" cy="94" r="11" fill="none" stroke="rgba(255,210,190,.45)" stroke-width="1.5"/>
        <path d="M232 94l4 4l8-8" fill="none" stroke="rgba(60,12,8,.6)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      ${url ? `<img class="bpa-ws-art-img" src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
    </span>`;
}

/** ISO-8601 week number of a date (UTC), or '' when the date is missing/invalid. */
export function isoWeek(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return String(Math.ceil(((d - yearStart) / 86400000 + 1) / 7));
}

/** "14.10.2026" (vi) / "14 Oct 2026" (en); '' when missing. */
export function fmtDate(value, { withYear = true } = {}) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  if (uiLanguage() === 'vi') {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return withYear ? `${dd}.${mm}.${date.getFullYear()}` : `${dd}.${mm}`;
  }
  return date.toLocaleDateString('en-GB', withYear
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'short' });
}

/** Week window "12.10 – 18.10.2026"; the end is exclusive (Monday 00:00), so show the day before. */
export function dateRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  if (!start || !end || Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
  const last = new Date(e.getTime() - 1);
  return `${fmtDate(s, { withYear: false })} – ${fmtDate(last)}`;
}

/** Locale-aware integer: 1.204 (vi) / 1,204 (en). */
export function fmtInt(n) {
  return Number(n || 0).toLocaleString(uiLanguage() === 'vi' ? 'vi-VN' : 'en-US');
}

export function minutesLabel(minutes) {
  return `${escapeHtml(String(minutes))} ${tr('MIN', 'PHÚT')}`;
}
