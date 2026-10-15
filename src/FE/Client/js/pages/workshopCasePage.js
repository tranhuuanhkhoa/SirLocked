import '../../../css/34-bpa-workshop.css';
import { workshopApi } from '../api/workshopApi.js';
import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';
import { renderReviewSection } from './workshop/reviewSection.js';
import { renderLeaderboardSection } from './workshop/leaderboardSection.js';
import { coverArtHtml, fmtInt } from './workshop/caseOfWeekBanner.js';

const TABS = ['stats', 'reviews', 'leaderboard'];

function pct(fraction) {
  return `${Math.round((fraction ?? 0) * 100)}%`;
}

function clampPct(fraction) {
  return Math.max(0, Math.min(100, Math.round((fraction ?? 0) * 100)));
}

const BACK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>';

function backLink() {
  return `<a class="bpa-link bpa-link--gold bpa-wsc-back" href="#/workshop">${BACK_ICON}${tr('Back to Workshop', 'Về Workshop')}</a>`;
}

/* ------------------------------- stats panel ------------------------------- */

const TICKS = 'M16.0 88.0L9.0 88.0M19.5 65.8L15.7 64.5M29.8 45.7L26.5 43.3M45.7 29.8L43.3 26.5M65.8 19.5L64.5 15.7M88.0 16.0L88.0 9.0M110.2 19.5L111.5 15.7M130.3 29.8L132.7 26.5M146.2 45.7L149.5 43.3M156.5 65.8L160.3 64.5M160.0 88.0L167.0 88.0';
const ARC = 'M24 88A64 64 0 0 1 152 88';

const TAG_ICONS = {
  evidence: '<path d="M7 5.6A8 8 0 0 1 19.6 10"/><path d="M4.6 9.6A8 8 0 0 0 4.2 14"/><path d="M8 20c-1.2-1.8-1.9-4-1.9-6.5a5.9 5.9 0 0 1 11.6-1.5"/><path d="M11.7 21c-1-2.2-1.6-4.6-1.6-7.3a1.9 1.9 0 0 1 3.8 0c0 2.6.6 4.6 1.6 6.3"/><path d="M17.9 17.6c.2-1.1.3-2.3.2-3.6"/>',
  weapon: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.6"/><path d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8M5.4 5.4l2 2M16.6 16.6l2 2M5.4 18.6l2-2M16.6 7.4l2-2"/>',
  motive: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.9"/><path d="M12 17.3v.01"/>',
  score: '<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="M12 17l4.2-5.2"/><circle cx="12" cy="17" r="1.3"/>',
};

function tagHtml({ icon, label, value, display, sub }, index) {
  return `
    <div class="bpa-wsc-tag" style="--wsc-tilt:${[-1.2, 0.9, -0.5, 1.1, -0.8][index % 5]}deg">
      <dt>
        <span class="bpa-wsc-twine" aria-hidden="true"><svg viewBox="0 0 30 44"><path d="M15 6C9 16 10 30 13 41M15 6C21 16 20 30 17 41" fill="none" stroke="#7d6845" stroke-width="1.6" stroke-linecap="round"/></svg><span class="bpa-wsc-knot"></span></span>
        <span class="bpa-wsc-hole" aria-hidden="true"></span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAG_ICONS[icon]}</svg>
        <span>${label}</span>
      </dt>
      <dd class="bpa-wsc-gauge">
        <svg viewBox="0 0 176 100" aria-hidden="true" focusable="false">
          <path class="bpa-wsc-ticks" d="${TICKS}"/>
          <path class="bpa-wsc-track" d="${ARC}"/>
          <path class="bpa-wsc-arc" pathLength="100" d="${ARC}" style="stroke-dasharray:${value} 100"/>
          <g class="bpa-wsc-pinm" style="transform:rotate(${(value * 1.8).toFixed(1)}deg)"><circle cx="24" cy="88" r="7.5" fill="url(#wsc-brass)" stroke="#5e4a1c" stroke-width="1"/></g>
        </svg>
        <span class="bpa-wsc-gnum">${display}</span>
      </dd>
      <dd class="bpa-wsc-tagsub">${sub}</dd>
    </div>`;
}

function verdictHtml(stats) {
  const ok = clampPct(stats.successRate);
  const bad = Math.min(100 - ok, clampPct(stats.wrongCulpritRate));
  return `
    <section class="bpa-wsc-card bpa-wsc-verdict" aria-labelledby="wsc-v-h">
      <span class="bpa-wsc-margin" aria-hidden="true"></span>
      <span class="bpa-pin" aria-hidden="true"></span>
      <p class="bpa-kicker bpa-wsc-kick">${tr('Findings report', 'Biên bản kết luận')}</p>
      <h3 id="wsc-v-h" class="bpa-wsc-h3">${tr('Accusation results', 'Kết quả cáo buộc')}</h3>
      <dl class="bpa-wsc-vgrid">
        <div>
          <dt><span class="bpa-wsc-stampl bpa-wsc-stampl--ok"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>${tr('Case solved', 'Phá án thành công')}</span></dt>
          <dd class="bpa-wsc-vbig bpa-wsc-vbig--ok">${pct(stats.successRate)}</dd>
          <dd class="bpa-wsc-vcap">${tr('Win rate', 'Tỉ lệ thắng')}</dd>
        </div>
        <div>
          <dt><span class="bpa-wsc-stampl bpa-wsc-stampl--bad"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>${tr('Wrong culprit accused', 'Buộc tội nhầm hung thủ')}</span></dt>
          <dd class="bpa-wsc-vbig bpa-wsc-vbig--bad">${pct(stats.wrongCulpritRate)}</dd>
          <dd class="bpa-wsc-vcap">${tr('Share of teams that picked the wrong culprit', 'Tỉ lệ đội chọn sai thủ phạm')}</dd>
        </div>
      </dl>
      <div class="bpa-wsc-splitbox" aria-hidden="true">
        <div class="bpa-wsc-split">
          <span class="bpa-wsc-sseg bpa-wsc-sseg--ok" style="width:calc(${ok}% - 1px)"></span>
          <span class="bpa-wsc-sseg bpa-wsc-sseg--bad" style="width:calc(${bad}% - 1px)"></span>
          <span class="bpa-wsc-splitpin" style="left:${ok}%"></span>
        </div>
        <div class="bpa-wsc-scale"><span>0</span><span>50%</span><span>100%</span></div>
      </div>
      <div class="bpa-wsc-vfoot">
        <p class="bpa-wsc-vnote">${tr(`Based on ${fmtInt(stats.totalPlays)} finished plays.`, `Tính trên ${fmtInt(stats.totalPlays)} lượt chơi đã kết thúc.`)}</p>
        <svg class="bpa-wsc-rstamp" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <defs><path id="wsc-ring" d="M48 48m-35 0a35 35 0 1 1 70 0a35 35 0 1 1-70 0"/></defs>
          <circle cx="48" cy="48" r="45" fill="none" stroke="currentColor" stroke-width="2.6"/>
          <circle cx="48" cy="48" r="41.5" fill="none" stroke="currentColor" stroke-width="1"/>
          <circle cx="48" cy="48" r="26" fill="none" stroke="currentColor" stroke-width="1.2"/>
          <text font-family="'Source Code Pro', monospace" font-size="9" font-weight="700" fill="currentColor"><textPath href="#wsc-ring" textLength="214" lengthAdjust="spacing">${tr('CASE OFFICE · SIR LOCKED · FILE 06 ·', 'SỞ ĐIỀU TRA · SIR LOCKED · HỒ SƠ 06 ·')}</textPath></text>
          <text x="48" y="45" font-family="'Source Code Pro', monospace" font-size="9" font-weight="700" fill="currentColor" text-anchor="middle">${tr('CROSS', 'ĐÃ')}</text>
          <text x="48" y="57" font-family="'Source Code Pro', monospace" font-size="9" font-weight="700" fill="currentColor" text-anchor="middle">${tr('CHECKED', 'ĐỐI CHIẾU')}</text>
        </svg>
      </div>
    </section>`;
}

function timeCardHtml(stats) {
  const avg = Math.round(stats.avgSolveTimeMinutes);
  const max = Math.max(60, Math.ceil((avg + 10) / 10) * 10);
  const at = Math.max(0, Math.min(100, (stats.avgSolveTimeMinutes / max) * 100));
  const ticks = [];
  for (let m = 0; m <= max; m += 10) ticks.push(m);
  const samples = fmtInt(stats.solveTimeSampleSize);
  // Stopwatch dial: one lap = 60 minutes.
  const lap = Math.min(60, Math.max(0, stats.avgSolveTimeMinutes));
  const dialTicks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    const r1 = i % 3 === 0 ? 30 : 33;
    const p = (r) => `${(60 + r * Math.sin(a)).toFixed(1)} ${(74 - r * Math.cos(a)).toFixed(1)}`;
    return `M${p(r1)}L${p(38)}`;
  }).join('');
  return `
    <section class="bpa-wsc-card bpa-wsc-timecard" aria-labelledby="wsc-t-h">
      <span class="bpa-wsc-tape" aria-hidden="true" style="top:-12px;left:34px;transform:rotate(-5deg)"></span>
      <span class="bpa-wsc-tape" aria-hidden="true" style="top:-12px;right:34px;transform:rotate(4deg)"></span>
      <p class="bpa-kicker bpa-wsc-kick">${tr(`Time log · ${samples} ${stats.solveTimeSampleSize === 1 ? 'game' : 'games'}`, `Nhật ký thời gian · ${samples} ván`)}</p>
      <h3 id="wsc-t-h" class="bpa-wsc-h3">${tr('Average solve time', 'Thời gian phá án trung bình')}</h3>
      <div class="bpa-wsc-tbody">
        <div class="bpa-wsc-watch">
          <svg viewBox="0 0 120 132" aria-hidden="true" focusable="false">
            <circle cx="60" cy="9" r="5" fill="none" stroke="#8a6e2e" stroke-width="2.4"/>
            <rect x="55" y="13" width="10" height="11" rx="1.5" fill="#8a6e2e"/>
            <path d="M95 33l6-6" stroke="#8a6e2e" stroke-width="4" stroke-linecap="round"/>
            <circle cx="60" cy="74" r="56" fill="#fbf6ed" stroke="rgba(58,52,43,.35)" stroke-width="1.2"/>
            <circle class="bpa-wsc-track" cx="60" cy="74" r="48"/>
            <path class="bpa-wsc-arc bpa-wsc-arc--w" pathLength="60" d="M60 26A48 48 0 1 1 60 122A48 48 0 1 1 60 26" style="stroke-dasharray:${lap.toFixed(1)} 60"/>
            <path class="bpa-wsc-ticks" d="${dialTicks}"/>
            <g class="bpa-wsc-pinm bpa-wsc-pinm--w" style="transform:rotate(${(lap * 6).toFixed(1)}deg)"><circle cx="60" cy="26" r="7.5" fill="url(#wsc-brass)" stroke="#5e4a1c" stroke-width="1"/></g>
          </svg>
          <span class="bpa-wsc-wnum">${avg}′</span>
        </div>
        <div class="bpa-wsc-tside">
          <p class="bpa-wsc-tcap">${tr(
            `<strong>${avg} minutes</strong> on average to close the case, over ${samples} games with timing data.`,
            `Trung bình <strong>${avg} phút</strong> để khép hồ sơ, tính trên ${samples} ván có dữ liệu thời gian.`,
          )}</p>
          <div class="bpa-wsc-ruler" aria-hidden="true">
          <span class="bpa-wsc-meanlbl" style="left:clamp(40px, ${at}%, calc(100% - 40px))">${tr('AVG', 'TB')} ${avg}′</span>
          <span class="bpa-wsc-meanpin" style="left:${at}%"></span>
          <span class="bpa-wsc-meanline" style="left:${at}%"></span>
          <div class="bpa-wsc-axis">
            ${ticks.map((m) => `<span style="left:${(m / max) * 100}%">${m}′</span>`).join('')}
          </div>
          <span class="bpa-wsc-fill" style="width:${at}%"></span>
          </div>
        </div>
      </div>
    </section>`;
}

function statsPanelHtml(stats) {
  if (!(stats.totalPlays > 0)) {
    return `
      <div class="bpa-wsc-emptystats" role="status">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        <p>${tr('Nobody has solved this case yet — be the first team on the record!', 'Chưa có ai phá án này — hãy là đội đầu tiên ghi tên vào hồ sơ!')}</p>
      </div>`;
  }
  const tags = [
    { icon: 'evidence', label: tr('Right evidence', 'Tìm đúng bằng chứng'), value: clampPct(stats.correctEvidenceRate), display: pct(stats.correctEvidenceRate), sub: tr('Picked every required clue', 'Chọn đủ bằng chứng bắt buộc') },
  ];
  if (stats.correctWeaponRate != null) {
    tags.push({ icon: 'weapon', label: tr('Right weapon', 'Đúng hung khí'), value: clampPct(stats.correctWeaponRate), display: pct(stats.correctWeaponRate), sub: tr('Picked the right method', 'Chọn đúng phương thức gây án') });
  }
  if (stats.correctMotiveRate != null) {
    tags.push({ icon: 'motive', label: tr('Right motive', 'Đúng động cơ'), value: clampPct(stats.correctMotiveRate), display: pct(stats.correctMotiveRate), sub: tr('Picked the right motive', 'Chọn đúng động cơ gây án') });
  }
  if (stats.averageScore != null) {
    const score = Math.round(stats.averageScore);
    tags.push({ icon: 'score', label: tr('Average score', 'Điểm trung bình'), value: Math.max(0, Math.min(100, score)), display: String(score), sub: tr('Scale 0–100', 'Thang điểm 0–100') });
  }
  const time = stats.avgSolveTimeMinutes != null ? timeCardHtml(stats) : '';
  return `
    <svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
      <defs><radialGradient id="wsc-brass" cx=".36" cy=".3" r=".75"><stop offset="0" stop-color="#fff1c2"/><stop offset=".45" stop-color="#c7a24b"/><stop offset="1" stop-color="#5e4a1c"/></radialGradient></defs>
    </svg>
    <div class="bpa-wsc-panhead">
      <p class="bpa-kicker bpa-wsc-kick bpa-wsc-kick--kraft">${tr(`Figures from ${fmtInt(stats.totalPlays)} ${stats.totalPlays === 1 ? 'play' : 'plays'}`, `Số liệu từ ${fmtInt(stats.totalPlays)} lượt chơi`)}</p>
      <span class="bpa-wsc-safe">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.2A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.8 0 3.3-.5 4.6-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
        ${tr('No culprit or answers revealed', 'Không tiết lộ thủ phạm hay đáp án')}
      </span>
    </div>
    <div class="bpa-wsc-row1${time ? '' : ' bpa-wsc-row1--solo'}">
      ${verdictHtml(stats)}
      ${time}
    </div>
    <dl class="bpa-wsc-tags">${tags.map(tagHtml).join('')}</dl>`;
}

/* ---------------------------------- page ---------------------------------- */

const TAB_ICONS = {
  stats: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 20h16"/><path d="M7.5 16.5v-5M12 16.5V6.5M16.5 16.5v-8"/></svg>',
  reviews: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96z"/></svg>',
  leaderboard: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H5a2.5 2.5 0 0 0 2.9 3.9"/><path d="M16.5 6H19a2.5 2.5 0 0 1-2.9 3.9"/><path d="M12 13.5v3"/><path d="M8.5 20h7l-1-3.5h-5z"/></svg>',
};

function tabLabel(name) {
  if (name === 'reviews') return tr('Reviews', 'Đánh giá');
  if (name === 'leaderboard') return tr('Leaderboard', 'Bảng xếp hạng');
  return tr('Statistics', 'Thống kê');
}

export async function renderWorkshopCasePage(app, caseId) {
  render(app, `<div class="bpa-container bpa-wsc-page"><p class="bpa-ws-loading" role="status">${tr('Loading the case file…', 'Đang tải hồ sơ vụ án…')}</p></div>`);

  let stats;
  let detail;
  try {
    // stats is the source of truth; case detail is supplementary cover/summary, so its failure is non-fatal.
    [stats, detail] = await Promise.all([
      workshopApi.stats(caseId),
      caseApi.detail(caseId).catch(() => null),
    ]);
  } catch (err) {
    render(app, `
      <div class="bpa-container bpa-wsc-page">
        <div>${backLink()}</div>
        <div class="bpa-ws-note" role="status">
          <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
          <p>${escapeHtml(err.message)}</p>
        </div>
      </div>`);
    return;
  }

  const title = detail?.title || stats.title || caseId;
  const summary = detail?.summary || '';
  const cover = detail?.coverImageUrl || '';
  const id = encodeURIComponent(caseId);
  const mechanics = detail?.mechanicsVersion === 3
    ? '<li class="bpa-chip bpa-chip--dark">V3 · CRACK</li>'
    : detail?.mechanicsVersion === 2 ? '<li class="bpa-chip">V2</li>' : '';

  render(app, `
  <div class="bpa-container bpa-wsc-page">
    <div>${backLink()}</div>

    <section class="bpa-wsc-head" aria-labelledby="wsc-h1">
      <span class="bpa-pin bpa-pin--red bpa-wsc-headpin" aria-hidden="true"></span>
      <div class="bpa-wsc-headmain">
        <div class="bpa-wsc-title">
          <p class="bpa-kicker">${tr('Workshop · Community file', 'Workshop · Hồ sơ cộng đồng')}</p>
          <h1 id="wsc-h1">${escapeHtml(title)}</h1>
        </div>
        <div class="bpa-wsc-byline" aria-hidden="true"></div>
        ${summary ? `<p class="bpa-wsc-lede">${escapeHtml(summary)}</p>` : ''}
        <ul class="bpa-wsc-chips" aria-label="${tr('Case facts', 'Thông tin vụ án')}">
          <li class="bpa-chip">${fmtInt(stats.totalPlays)} ${tr(stats.totalPlays === 1 ? 'play' : 'plays', 'lượt chơi')}</li>
          ${detail ? `<li class="bpa-chip">${fmtInt(detail.characterCount)} ${tr(detail.characterCount === 1 ? 'suspect' : 'suspects', 'nghi phạm')}</li>` : ''}
          ${detail ? `<li class="bpa-chip">${escapeHtml(String(detail.estimatedMinutes))} ${tr('min', 'phút')}</li>` : ''}
          ${mechanics}
        </ul>
        <div class="bpa-wsc-actions">
          <button class="bpa-btn bpa-btn--red" id="ws-play" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>
            ${tr('Play this case', 'Chơi vụ án này')}
          </button>
          <a class="bpa-btn bpa-btn--ink" href="#/cases/${id}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6h6.2l2 2.3h8.8v11.2h-17z"/><path d="M3.5 11h17"/></svg>
            ${tr('View case details', 'Xem chi tiết case')}
          </a>
        </div>
      </div>
      <figure class="bpa-wsc-photo">
        <span class="bpa-wsc-tape" aria-hidden="true" style="top:-11px;left:-18px;transform:rotate(-28deg)"></span>
        <span class="bpa-wsc-tape" aria-hidden="true" style="top:-11px;right:-18px;transform:rotate(31deg)"></span>
        ${coverArtHtml(caseId, cover)}
      </figure>
    </section>

    <div class="bpa-wsc-file">
      <div class="bpa-wsc-tabs" role="tablist" aria-label="${tr('Community file of the case', 'Hồ sơ cộng đồng của vụ án')}">
        ${TABS.map((name, i) => `
          <button type="button" role="tab" class="bpa-wsc-tab" id="wsc-tab-${name}" data-tab="${name}"
            aria-selected="${i === 0}" aria-controls="wsc-panel-${name}" tabindex="${i === 0 ? 0 : -1}">
            <span class="bpa-wsc-tabl">${TAB_ICONS[name]}<span>${tabLabel(name)}</span></span>
          </button>`).join('')}
      </div>
      <div class="bpa-wsc-folder">
        <div class="bpa-wsc-lensbox" aria-hidden="true"><span class="bpa-wsc-lens"></span></div>
        <div class="bpa-wsc-pane is-first">
          <div class="bpa-wsc-panel" id="wsc-panel-stats" role="tabpanel" aria-labelledby="wsc-tab-stats" tabindex="0" data-panel="stats">
            <h2 class="bpa-sr">${tr('Case statistics', 'Thống kê vụ án')}</h2>
            ${statsPanelHtml(stats)}
          </div>
          <div class="bpa-wsc-panel" id="wsc-panel-reviews" role="tabpanel" aria-labelledby="wsc-tab-reviews" tabindex="0" data-panel="reviews" hidden>
            <h2 class="bpa-sr">${tr('Community reviews', 'Đánh giá của cộng đồng')}</h2>
            <div id="ws-review-mount"></div>
          </div>
          <div class="bpa-wsc-panel" id="wsc-panel-leaderboard" role="tabpanel" aria-labelledby="wsc-tab-leaderboard" tabindex="0" data-panel="leaderboard" hidden>
            <h2 class="bpa-sr">${tr('Team leaderboard', 'Bảng xếp hạng các đội')}</h2>
            <div id="ws-leaderboard-mount"></div>
          </div>
        </div>
      </div>
    </div>
  </div>`);

  // Lazy-mount each tab's widget on first open (avoid fetching review + leaderboard up front).
  const mounted = new Set();
  function failPanel(el, what, err) {
    console.error(`workshop detail: ${what.en} mount failed`, err);
    if (el) el.innerHTML = `<p class="bpa-wsc-error" role="status">${tr(`Could not load ${what.en}.`, `Không tải được ${what.vi}.`)}</p>`;
  }
  function mountOnce(tab) {
    if (mounted.has(tab)) return;
    mounted.add(tab);
    if (tab === 'reviews') {
      const el = app.querySelector('#ws-review-mount');
      const what = { en: 'reviews', vi: 'đánh giá' };
      try {
        Promise.resolve(renderReviewSection(caseId, el)).catch((err) => failPanel(el, what, err));
      } catch (err) {
        failPanel(el, what, err);
      }
    } else if (tab === 'leaderboard') {
      const el = app.querySelector('#ws-leaderboard-mount');
      const what = { en: 'the leaderboard', vi: 'bảng xếp hạng' };
      try {
        Promise.resolve(renderLeaderboardSection(caseId, el)).catch((err) => failPanel(el, what, err));
      } catch (err) {
        failPanel(el, what, err);
      }
    }
  }

  const tabButtons = [...app.querySelectorAll('.bpa-wsc-tab')];
  const pane = app.querySelector('.bpa-wsc-pane');
  const lensBox = app.querySelector('.bpa-wsc-lensbox');
  let current = 'stats';
  let flip = false;

  // Lens wipe: the newly opened panel is revealed through a growing circle from its tab.
  function wipeFrom(tabBtn) {
    if (!pane || !tabBtn) return;
    const x = Math.round(tabBtn.getBoundingClientRect().left + tabBtn.offsetWidth / 2 - pane.getBoundingClientRect().left);
    flip = !flip;
    pane.classList.remove('is-first', 'bpa-wipe-a', 'bpa-wipe-b');
    pane.style.setProperty('--bpa-wipe-at', `${x}px 0px`);
    pane.classList.add(flip ? 'bpa-wipe-b' : 'bpa-wipe-a');
    if (lensBox) {
      lensBox.style.setProperty('--wsc-wx', `${x}px`);
      lensBox.classList.remove('is-a', 'is-b');
      lensBox.classList.add(flip ? 'is-b' : 'is-a');
    }
  }

  function showTab(name, { focus = false } = {}) {
    if (name === current) {
      if (focus) tabButtons.find((b) => b.dataset.tab === name)?.focus();
      return;
    }
    current = name;
    let selected = null;
    tabButtons.forEach((b) => {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on) selected = b;
    });
    app.querySelectorAll('.bpa-wsc-panel').forEach((p) => {
      p.hidden = p.dataset.panel !== name;
    });
    wipeFrom(selected);
    mountOnce(name);
    if (focus && selected) selected.focus();
  }

  tabButtons.forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
    b.addEventListener('keydown', (e) => {
      let i = TABS.indexOf(current);
      if (e.key === 'ArrowRight') i = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') i = (i + TABS.length - 1) % TABS.length;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = TABS.length - 1;
      else return;
      e.preventDefault();
      showTab(TABS[i], { focus: true });
    });
  });

  app.querySelector('#ws-play').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const room = await roomApi.create(caseId);
      toast(tr(`Room ${room.roomCode} created.`, `Đã tạo phòng ${room.roomCode}.`), 'success');
      window.location.hash = `#/lobby/${room.roomId}`;
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
}
