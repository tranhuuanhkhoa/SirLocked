import '../../../css/34-bpa-workshop.css';
import { weeklyApi } from '../api/weeklyApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr, plural } from '../services/i18n.js';
import { leaderboardTableHtml, sealSvg, teamNames, teamMonogram, formatTime } from './workshop/leaderboardTable.js';
import { coverArtHtml, isoWeek, fmtDate, fmtInt, minutesLabel } from './workshop/caseOfWeekBanner.js';

/**
 * Weekly Challenge page (#/workshop/challenge): the active challenge case, a flip-clock countdown
 * to its end, and the week-scoped leaderboard (reuses the Phase 3 table via leaderboardTableHtml).
 * Returns a cleanup function that stops the countdown timer when navigating away.
 *
 * The challenge leaderboard endpoint has no metric parameter: it always returns the "fastest"
 * board for the challenge window. "Top score" re-sorts those same entries by score on the client.
 */

const BACK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>';
const TIMER_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M9.5 3h5M12 3v3M18.3 6.7l1.4-1.4"/></svg>';
const STAR_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>';
const FOLDER_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5h6.5l2 2.5H21v10.5H3z"/><path d="M3 11h18"/></svg>';

const UNITS = [
  { key: 'd', label: () => tr('DAYS', 'NGÀY') },
  { key: 'h', label: () => tr('HRS', 'GIỜ') },
  { key: 'm', label: () => tr('MIN', 'PHÚT') },
  { key: 's', label: () => tr('SEC', 'GIÂY') },
];

function split(totalSeconds) {
  const t = Math.max(0, totalSeconds);
  return {
    d: Math.floor(t / 86400),
    h: Math.floor((t % 86400) / 3600),
    m: Math.floor((t % 3600) / 60),
    s: t % 60,
  };
}

const pad = (n) => String(n).padStart(2, '0');

function titleRowHtml(week) {
  return `
    <div class="bpa-ws-titlerow">
      <div class="bpa-label bpa-ws-label">
        <p class="bpa-kicker">Workshop${week ? ` · ${tr('Week', 'Tuần')} ${week}` : ''}</p>
        <h1 class="bpa-ws-h1">${tr('Weekly challenge', 'Thử thách tuần')}</h1>
      </div>
      <p class="bpa-ws-intro">${tr(
        'One community case a week. Solve it with your partner as fast — or as thoroughly — as you can to get your names on the weekly board.',
        'Mỗi tuần một vụ án cộng đồng. Cùng đồng đội phá án thật nhanh — hoặc thật kỹ — để có tên trên bảng xếp hạng tuần.',
      )}</p>
      <a class="bpa-link bpa-link--gold bpa-ch-back" href="#/workshop">${BACK_ICON}${tr('Back to Workshop', 'Về Workshop')}</a>
    </div>`;
}

/** Almost blank front page: no challenge this week, or the challenge could not be loaded. */
function blankPageHtml(title, sub) {
  const week = isoWeek(new Date());
  return `
  <div class="bpa-container bpa-ch-page">
    ${titleRowHtml('')}
    <section class="bpa-ch-news bpa-ch-blank" aria-labelledby="ch-empty-h">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <div class="bpa-ch-mastrow bpa-ch-mastrow--solo"><p class="bpa-ch-mast">${tr('221B GAZETTE', 'BÁO 221B')}</p></div>
      <div class="bpa-ch-dateline">
        <span class="bpa-ch-red">${tr('WEEKLY CHALLENGE', 'THỬ THÁCH TUẦN')}</span>
        ${week ? `<span>${tr('WEEK', 'TUẦN')} ${week}</span>` : ''}
      </div>
      <div class="bpa-ch-void">
        <div class="bpa-ch-ghost" aria-hidden="true"><span></span><span></span><span></span></div>
        <span class="bpa-ch-crease" aria-hidden="true"></span>
        <div class="bpa-ch-notice">
          <h2 id="ch-empty-h" class="bpa-ch-emptymsg">${title}${sub ? ` <span>${sub}</span>` : ''}</h2>
          <a class="bpa-btn bpa-btn--ink" href="#/workshop">${BACK_ICON}${tr('Back to Workshop', 'Về Workshop')}</a>
        </div>
        <svg class="bpa-ch-mag" viewBox="0 0 170 170" width="150" height="150" aria-hidden="true" focusable="false">
          <defs><radialGradient id="bpa-ch-lens" cx=".38" cy=".34" r=".72"><stop offset="0" stop-color="#fffaf0" stop-opacity=".6"/><stop offset=".6" stop-color="#f3ead7" stop-opacity=".16"/><stop offset="1" stop-color="#b9aa88" stop-opacity=".35"/></radialGradient></defs>
          <path d="M108 108L148 148" stroke="#2a1b10" stroke-width="17" stroke-linecap="round"/>
          <path d="M110 110L147 147" stroke="#6a4528" stroke-width="10" stroke-linecap="round"/>
          <path d="M103 103L113 113" stroke="#c7a24b" stroke-width="15"/>
          <circle cx="70" cy="70" r="50" fill="url(#bpa-ch-lens)"/>
          <circle cx="70" cy="70" r="50" fill="none" stroke="#c7a24b" stroke-width="9"/>
          <circle cx="70" cy="70" r="54.5" fill="none" stroke="#5e4a1c" stroke-width="1.2"/>
          <circle cx="70" cy="70" r="45.5" fill="none" stroke="#5e4a1c" stroke-width="1.2"/>
          <path d="M37 54a36 36 0 0 1 27 -21" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="3.5" stroke-linecap="round"/>
        </svg>
      </div>
    </section>
  </div>`;
}

/** Board for the selected metric. "topScore" = the same entries re-sorted by score (client side). */
function viewBoard(board, metric) {
  const entries = board?.entries || [];
  if (metric !== 'topScore') return { ...board, metric: 'fastest', entries };
  const sorted = [...entries]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)
      || (a.solveTimeSeconds ?? Infinity) - (b.solveTimeSeconds ?? Infinity)
      || String(a.completedAt).localeCompare(String(b.completedAt)))
    .map((e, i) => ({ ...e, rank: i + 1 }));
  return { ...board, metric: 'topScore', entries: sorted };
}

function namesHtml(names, cls) {
  if (names.length === 0) return `<span class="${cls}">${tr('Anonymous team', 'Đội ẩn danh')}</span>`;
  return `<span class="${cls}">${names.map((n, i) => (i === 0
    ? escapeHtml(n)
    : ` <span class="bpa-ch-l2"><i>&amp;</i> ${escapeHtml(n)}</span>`)).join('')}</span>`;
}

function monoPairHtml(names, extra = '') {
  const list = names.length ? names.slice(0, 2) : [''];
  return `<span class="bpa-ch-pair" aria-hidden="true">${list.map((n) =>
    `<span class="bpa-ch-mono${extra}">${escapeHtml(teamMonogram(n))}</span>`).join('')}</span>`;
}

function clockHtml(left) {
  const now = split(left);
  return UNITS.map((u, i) => `
    ${i ? '<span class="bpa-ch-colon"></span>' : ''}
    <div class="bpa-ch-unit">
      <div class="bpa-ch-flap" data-unit="${u.key}">
        <span class="bpa-ch-half bpa-ch-top"><span data-v>${pad(now[u.key])}</span></span>
        <span class="bpa-ch-half bpa-ch-bot"><span data-v>${pad(now[u.key])}</span></span>
        <span class="bpa-ch-leaves">
          <span class="bpa-ch-half bpa-ch-bot"><span data-p>${pad(now[u.key])}</span></span>
          <span class="bpa-ch-half bpa-ch-top bpa-ch-fall"><span data-p>${pad(now[u.key])}</span></span>
          <span class="bpa-ch-half bpa-ch-bot bpa-ch-land"><span data-v>${pad(now[u.key])}</span></span>
        </span>
      </div>
      <span class="bpa-ch-ul">${u.label()}</span>
    </div>`).join('');
}

function timerText(left) {
  const t = split(left);
  return tr(
    `Time left: ${t.d} ${plural(t.d, 'day', 'days')} ${t.h} ${plural(t.h, 'hour', 'hours')} ${t.m} ${plural(t.m, 'minute', 'minutes')}`,
    `Còn lại: ${t.d} ngày ${t.h} giờ ${t.m} phút`,
  );
}

function hhmm(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pageHtml(challenge, board, { ended, left, hasDeadline }, metric) {
  const id = encodeURIComponent(challenge.caseId);
  const week = isoWeek(challenge.weekStart);
  const fastest = board?.entries?.[0] || null;
  const total = board?.totalRanked ?? (board?.entries?.length || 0);
  const start = fmtDate(challenge.weekStart, { withYear: false });
  const end = fmtDate(challenge.weekEnd, { withYear: false });
  const endTime = hhmm(challenge.weekEnd);
  const champNames = fastest ? teamNames(fastest.teamDisplay) : [];

  const desk = `
    <section class="bpa-ch-desk" aria-label="${ended
      ? tr('Final result and challenge schedule', 'Kết quả chung cuộc và lịch thử thách')
      : tr('Time left and challenge schedule', 'Thời gian còn lại và lịch thử thách')}">
      <span class="bpa-ch-screw" aria-hidden="true" style="top:11px;left:11px"></span>
      <span class="bpa-ch-screw" aria-hidden="true" style="top:11px;right:11px"></span>
      <span class="bpa-ch-screw" aria-hidden="true" style="bottom:11px;left:11px"></span>
      <span class="bpa-ch-screw" aria-hidden="true" style="bottom:11px;right:11px"></span>
      <div class="bpa-ch-dl">
        ${ended ? `
          <p class="bpa-kicker bpa-ch-kick">${tr('Winner · Fastest solve', 'Đứng đầu · Phá nhanh nhất')}</p>
          <p class="bpa-sr" role="timer">${tr('The challenge has ended', 'Thử thách đã kết thúc')}</p>
          ${fastest ? `
            <div class="bpa-ch-champ">
              <span class="bpa-ch-champseal">${sealSvg(1, 52)}</span>
              <div class="bpa-ch-champtxt">
                ${monoPairHtml(champNames)}
                ${namesHtml(champNames, 'bpa-ch-champname')}
              </div>
              <span class="bpa-ch-champtime"><span class="bpa-sr">${tr('Time', 'Thời gian')} </span>${formatTime(fastest.solveTimeSeconds)}</span>
            </div>` : `<p class="bpa-ch-none">${tr('No team solved the case this week.', 'Không đội nào phá án trong tuần này.')}</p>`}`
        : `
          <p class="bpa-kicker bpa-ch-kick" aria-hidden="true">${tr('Time left', 'Còn lại')}</p>
          <p class="bpa-sr" role="timer" data-timer-text>${hasDeadline ? timerText(left) : ''}</p>
          ${hasDeadline ? `<div class="bpa-ch-clock" aria-hidden="true">${clockHtml(left)}</div>` : ''}`}
      </div>
      <span class="bpa-ch-vrule" aria-hidden="true"></span>
      <div class="bpa-ch-dr">
        <p class="bpa-kicker bpa-ch-kick">${tr('Challenge schedule', 'Lịch thử thách')}</p>
        <dl class="bpa-ch-stand">
          ${start ? `<div><dt>${tr('Opened', 'Bắt đầu')}</dt><dd>${escapeHtml(start)}</dd></div>` : ''}
          ${end ? `<div><dt>${ended ? tr('Closed', 'Đã đóng') : tr('Closes', 'Kết thúc')}</dt><dd>${escapeHtml(end)}${endTime ? ` <small>${endTime}</small>` : ''}</dd></div>` : ''}
        </dl>
        ${ended
          ? `<a class="bpa-btn bpa-btn--red bpa-ch-cta" href="#/workshop/${id}">${FOLDER_ICON}<span>${tr('View the case', 'Xem vụ án')}</span></a>`
          : `<a class="bpa-btn bpa-btn--red bpa-ch-cta" href="#/cases/${id}">${TIMER_ICON}<span>${tr('Play the challenge', 'Chơi thử thách')}</span></a>`}
      </div>
    </section>`;

  const view = viewBoard(board, metric);
  return `
  <div class="bpa-container bpa-ch-page${ended ? ' is-ended' : ''}">
    ${titleRowHtml(week)}
    <div class="bpa-ch-grid">
      <div class="bpa-ch-col">
        <section class="bpa-ch-news" aria-labelledby="ch-case-h">
          <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
          <div class="bpa-ch-mastrow">
            <span class="bpa-ch-ear">${tr('SPECIAL ISSUE', 'SỐ ĐẶC BIỆT')}</span>
            <p class="bpa-ch-mast">${tr('221B GAZETTE', 'BÁO 221B')}</p>
            ${week ? `<span class="bpa-ch-ear bpa-ch-ear--r">${tr('WEEK', 'TUẦN')} ${week}</span>` : '<span></span>'}
          </div>
          <div class="bpa-ch-dateline">
            <span class="bpa-ch-red">${tr('WEEKLY CHALLENGE', 'THỬ THÁCH TUẦN')}</span>
            ${start && end ? `<span>${escapeHtml(start)} – ${escapeHtml(fmtDate(challenge.weekEnd))}</span>` : ''}
          </div>
          <h2 id="ch-case-h" class="bpa-ch-head">${escapeHtml(challenge.caseTitle)}</h2>
          <div class="bpa-ch-body">
            <figure class="bpa-ch-fig${ended ? ' is-old' : ''}">
              ${ended ? `<div class="bpa-ch-endwrap"><p class="bpa-ch-end">${tr('Challenge', 'Thử thách')} <span class="bpa-ch-l2">${tr('has ended', 'đã kết thúc')}</span></p></div>` : ''}
              <div class="bpa-ch-art">${coverArtHtml(challenge.caseId, challenge.coverImageUrl)}</div>
              <figcaption class="bpa-ch-cap">${tr('Exhibit of the week', 'Hiện vật của tuần')}</figcaption>
            </figure>
            <div class="bpa-ch-text">
              ${challenge.summary ? `<p class="bpa-ch-lede">${escapeHtml(challenge.summary)}</p>` : ''}
              ${challenge.estimatedMinutes ? `<div class="bpa-ch-chips"><span class="bpa-chip">${minutesLabel(challenge.estimatedMinutes)}</span></div>` : ''}
              <dl class="bpa-ch-facts">
                <div><dt>${tr(`${plural(total, 'team', 'teams')} solved it`, 'đội đã phá án')}</dt><dd>${fmtInt(total)}</dd></div>
                ${fastest?.solveTimeSeconds != null ? `<div class="bpa-ch-fact--warn"><dt>${tr('weekly record', 'kỷ lục tuần')}</dt><dd>${formatTime(fastest.solveTimeSeconds)}</dd></div>` : ''}
              </dl>
            </div>
          </div>
        </section>
        ${desk}
      </div>

      <section class="bpa-ch-ledger" aria-labelledby="ch-lb-h">
        <span class="bpa-ch-margin bpa-ch-margin--a" aria-hidden="true"></span>
        <span class="bpa-ch-margin bpa-ch-margin--b" aria-hidden="true"></span>
        <span class="bpa-pin" aria-hidden="true"></span>
        ${ended ? `<div class="bpa-ch-lbstamp" aria-hidden="true"><span class="bpa-stamp bpa-stamp--teal bpa-slam-a">${tr('Final', 'Chung cuộc')}</span></div>` : ''}
        <p class="bpa-kicker bpa-ch-kick bpa-ch-kick--ink">${ended
          ? tr('Final standings', 'Kết quả chung cuộc')
          : tr('Ranking ledger', 'Sổ xếp hạng')}${week ? ` · ${tr('Week', 'Tuần')} ${week}` : ''}</p>
        <h2 id="ch-lb-h" class="bpa-ch-h2">${tr('Weekly leaderboard', 'Bảng xếp hạng tuần')}</h2>
        <div class="bpa-ch-segs" role="group" aria-label="${tr('Rank by', 'Xếp hạng theo')}">
          <button type="button" class="bpa-seg bpa-ch-seg" data-metric="fastest" aria-pressed="${metric === 'fastest'}">${TIMER_ICON}<span>${tr('Fastest solve', 'Phá nhanh nhất')}</span></button>
          <button type="button" class="bpa-seg bpa-ch-seg" data-metric="topScore" aria-pressed="${metric === 'topScore'}">${STAR_ICON}<span>${tr('Top score', 'Top điểm')}</span></button>
        </div>
        <p class="bpa-ch-rule">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.01"/></svg>
          <span data-rule aria-live="polite">${ruleText(metric)}</span>
        </p>
        <div class="bpa-ch-lb" data-lb>${boardHtml(view)}</div>
      </section>
    </div>
  </div>`;
}

function ruleText(metric) {
  return metric === 'topScore'
    ? tr('Ranked by the highest investigation score this week (among teams with a recorded solve time).',
      'Xếp hạng theo điểm điều tra cao nhất trong tuần (trong các đội đã ghi nhận thời gian phá án).')
    : tr('Ranked by each team’s fastest successful solve this week.', 'Xếp hạng theo lần phá án thành công nhanh nhất trong tuần.');
}

function boardHtml(view) {
  const caption = view.metric === 'topScore'
    ? tr('Weekly leaderboard: top score', 'Bảng xếp hạng tuần: top điểm')
    : tr('Weekly leaderboard: fastest solve', 'Bảng xếp hạng tuần: phá nhanh nhất');
  return leaderboardTableHtml(view, { marks: 'seal', record: false, caption });
}

export async function renderChallengePage(app) {
  render(app, `<div class="bpa-container bpa-ch-page"><p class="bpa-ws-loading" role="status">${tr('Loading the weekly challenge…', 'Đang tải thử thách tuần…')}</p></div>`);

  let challenge;
  let board;
  try {
    [challenge, board] = await Promise.all([
      weeklyApi.challenge(),
      weeklyApi.challengeLeaderboard(100),
    ]);
  } catch (err) {
    toast(err.message || tr('Could not load the weekly challenge.', 'Không tải được thử thách tuần.'), 'error');
    render(app, blankPageHtml(tr('Could not load the weekly challenge.', 'Không tải được thử thách tuần.'), tr('Please try again later.', 'Vui lòng thử lại sau.')));
    return;
  }

  if (!challenge) {
    render(app, blankPageHtml(tr('There is no weekly challenge right now.', 'Hiện chưa có thử thách tuần nào.'), tr('Check back later!', 'Hãy quay lại sau!')));
    return;
  }

  const deadline = new Date(challenge.weekEnd).getTime();
  const hasDeadline = !Number.isNaN(deadline);
  const secondsLeft = () => (hasDeadline ? Math.max(0, Math.floor((deadline - Date.now()) / 1000)) : 0);
  let metric = 'fastest';
  let wipe = 0;
  let timer = null;
  let shown = secondsLeft();
  const flips = { d: 0, h: 0, m: 0, s: 0 };

  function draw() {
    const ended = hasDeadline && deadline - Date.now() <= 0;
    shown = secondsLeft();
    render(app, pageHtml(challenge, board, { ended, left: shown, hasDeadline }, metric));
    wireBoard();
    clearInterval(timer);
    timer = null;
    if (!ended && hasDeadline) timer = setInterval(tick, 1000);
  }

  function tick() {
    if (deadline - Date.now() <= 0) {
      clearInterval(timer);
      timer = null;
      draw(); // switch to the ended state
      return;
    }
    const left = secondsLeft();
    if (left === shown) return;
    const was = split(shown);
    const now = split(left);
    shown = left;
    UNITS.forEach(({ key }) => {
      if (was[key] === now[key]) return;
      const flap = app.querySelector(`.bpa-ch-flap[data-unit="${key}"]`);
      if (!flap) return;
      flap.querySelectorAll('[data-p]').forEach((el) => { el.textContent = pad(was[key]); });
      flap.querySelectorAll('[data-v]').forEach((el) => { el.textContent = pad(now[key]); });
      flips[key] += 1;
      flap.classList.remove('is-fa', 'is-fb');
      flap.classList.add(flips[key] % 2 ? 'is-fa' : 'is-fb');
    });
    const text = app.querySelector('[data-timer-text]');
    if (text && was.m !== now.m) text.textContent = timerText(left);
  }

  function wireBoard() {
    app.querySelectorAll('.bpa-ch-seg[data-metric]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.metric;
        if (next === metric) return;
        metric = next;
        app.querySelectorAll('.bpa-ch-seg[data-metric]').forEach((b) =>
          b.setAttribute('aria-pressed', String(b.dataset.metric === metric)));
        const rule = app.querySelector('[data-rule]');
        if (rule) rule.textContent = ruleText(metric);
        const lb = app.querySelector('[data-lb]');
        if (lb) {
          lb.innerHTML = boardHtml(viewBoard(board, metric));
          wipe += 1;
          lb.style.setProperty('--bpa-wipe-at', metric === 'topScore' ? '75% 0%' : '25% 0%');
          lb.classList.remove('bpa-wipe-a', 'bpa-wipe-b', 'is-intro');
          lb.classList.add(wipe % 2 ? 'bpa-wipe-a' : 'bpa-wipe-b');
        }
      });
    });
  }

  draw();
  return () => clearInterval(timer);
}
