import { escapeHtml } from '../../utils/dom.js';

/**
 * Shared leaderboard table renderer, reused by the per-case leaderboard section (Phase 3) and the
 * weekly challenge page (Phase 5) so the table markup lives in one place.
 * Medal glyphs mark the top 3; .ws-lb-rank-* tokens in 09-app.css colour them.
 *
 * The metric-specific column follows board.metric: "topScore" shows only Điểm, anything else
 * (default "fastest") shows only Thời gian — never both.
 */

const MEDALS = ['🥇', '🥈', '🥉'];

export function leaderboardTableHtml(board) {
  const entries = board?.entries || [];
  if (entries.length === 0) {
    return '<p class="ws-lb-empty">Chưa đội nào phá án — hãy là đội đầu tiên!</p>';
  }

  const isTopScore = board?.metric === 'topScore';
  const metricHead = isTopScore
    ? '<th class="ws-lb-col-score">Điểm</th>'
    : '<th class="ws-lb-col-time">Thời gian</th>';
  const rows = entries.map((e) => rowHtml(e, isTopScore)).join('');
  const total = board.totalRanked || entries.length;
  return `
    <table class="ws-lb-table">
      <thead>
        <tr>
          <th class="ws-lb-col-rank">#</th>
          <th class="ws-lb-col-team">Đội</th>
          ${metricHead}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${total > entries.length ? `<p class="ws-lb-foot">Hiển thị ${entries.length} / ${total} đội</p>` : ''}`;
}

function rowHtml(e, isTopScore) {
  const isTop = e.rank <= 3;
  const rankCell = isTop
    ? `<span class="ws-lb-medal" aria-label="Hạng ${e.rank}">${MEDALS[e.rank - 1]}</span>`
    : `<span class="ws-lb-rank-num">${e.rank}</span>`;
  const metricCell = isTopScore
    ? `<td class="ws-lb-col-score">${e.score}</td>`
    : `<td class="ws-lb-col-time">${formatTime(e.solveTimeSeconds)}</td>`;
  return `
    <tr class="ws-lb-row ws-lb-rank-${isTop ? e.rank : 'n'}">
      <td class="ws-lb-col-rank">${rankCell}</td>
      <td class="ws-lb-col-team">${escapeHtml(e.teamDisplay)}</td>
      ${metricCell}
    </tr>`;
}

export function formatTime(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
