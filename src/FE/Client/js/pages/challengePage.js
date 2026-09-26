import { weeklyApi } from '../api/weeklyApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { leaderboardTableHtml } from './workshop/leaderboardTable.js';

/**
 * Weekly Challenge page (#/workshop/challenge): the active challenge case, a countdown to its end,
 * and the week-scoped leaderboard (reuses the Phase 3 table via leaderboardTableHtml).
 * Returns a cleanup function that stops the countdown timer when navigating away.
 */
export async function renderChallengePage(app) {
  render(app, '<div class="page"><p class="muted">Đang tải thử thách tuần…</p></div>');

  let challenge;
  let board;
  try {
    [challenge, board] = await Promise.all([
      weeklyApi.challenge(),
      weeklyApi.challengeLeaderboard(100),
    ]);
  } catch (err) {
    toast(err.message || 'Không tải được thử thách tuần.', 'error');
    render(app, '<div class="page"><div class="empty-state">Không tải được thử thách tuần.</div></div>');
    return;
  }

  if (!challenge) {
    render(app, '<div class="page"><div class="ws-weekly-empty">Hiện chưa có thử thách tuần nào. Hãy quay lại sau!</div></div>');
    return;
  }

  render(app, `
    <div class="page ws-weekly">
      <span class="ws-weekly-tag">Thử thách tuần</span>
      <h2>${escapeHtml(challenge.caseTitle)}</h2>
      <p class="muted">${escapeHtml(challenge.summary)}</p>
      <div class="ws-weekly-countdown" role="timer">Đang tính…</div>
      <div class="case-actions">
        <a class="btn btn-primary" href="#/cases/${encodeURIComponent(challenge.caseId)}">Chơi thử thách</a>
      </div>
      <h3 class="section-title">Bảng xếp hạng tuần</h3>
      <div class="ws-lb">${leaderboardTableHtml(board)}</div>
    </div>`);

  const countdownEl = app.querySelector('.ws-weekly-countdown');
  const deadline = new Date(challenge.weekEnd).getTime();

  const tick = () => {
    const remaining = deadline - Date.now();
    if (Number.isNaN(deadline)) {
      countdownEl.textContent = '';
      return;
    }
    if (remaining <= 0) {
      countdownEl.textContent = 'Thử thách đã kết thúc';
      return;
    }
    const totalSeconds = Math.floor(remaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    countdownEl.textContent = `Còn lại: ${days} ngày ${hours} giờ ${minutes} phút`;
  };

  tick();
  const timer = setInterval(tick, 30000);
  return () => clearInterval(timer);
}
