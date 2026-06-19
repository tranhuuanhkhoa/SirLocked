import { leaderboardApi } from '../../api/leaderboardApi.js';
import { escapeHtml } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';

/**
 * Standalone leaderboard widget for a case. Self-contained:
 *
 *   import { renderLeaderboardSection } from './pages/workshop/leaderboardSection.js';
 *   renderLeaderboardSection(caseId, document.querySelector('#leaderboard-mount'));
 *
 * Read-only: shows the top teams who solved the case, by fastest first-solve or by score.
 * (Medal glyphs are used for the top 3 rather than the lucide package, which is not installed
 * in this repo; top-3 colouring comes from .ws-lb-rank-* tokens in 09-app.css.)
 */

const METRICS = [
  { key: 'fastest', label: 'Phá nhanh nhất' },
  { key: 'topScore', label: 'Top điểm' },
];

const MEDALS = ['🥇', '🥈', '🥉'];

export async function renderLeaderboardSection(caseId, mount) {
  if (!mount) return;
  const state = { caseId, mount, metric: 'fastest' };
  mount.classList.add('ws-lb');
  await load(state);
}

async function load(state) {
  renderShell(state, '<p class="ws-lb-loading">Đang tải bảng xếp hạng…</p>');

  let board;
  try {
    board = await leaderboardApi.get(state.caseId, state.metric);
  } catch (err) {
    toast(err.message || 'Không tải được bảng xếp hạng.', 'error');
    renderShell(state, '<p class="ws-lb-error">Không tải được bảng xếp hạng.</p>');
    return;
  }
  renderShell(state, boardHtml(board));
}

function renderShell(state, bodyHtml) {
  state.mount.innerHTML = `
    <section class="ws-lb-panel">
      <div class="ws-lb-tabs" role="tablist">
        ${METRICS.map((m) => `
          <button type="button" class="ws-lb-tab ${m.key === state.metric ? 'is-active' : ''}"
            data-metric="${m.key}" role="tab" aria-selected="${m.key === state.metric}">${escapeHtml(m.label)}</button>`).join('')}
      </div>
      <div class="ws-lb-body">${bodyHtml}</div>
    </section>`;

  state.mount.querySelectorAll('.ws-lb-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.metric;
      if (next === state.metric) return;
      state.metric = next;
      load(state);
    });
  });
}

function boardHtml(board) {
  const entries = board?.entries || [];
  if (entries.length === 0) {
    return '<p class="ws-lb-empty">Chưa đội nào phá án — hãy là đội đầu tiên!</p>';
  }

  const rows = entries.map(rowHtml).join('');
  const total = board.totalRanked || entries.length;
  return `
    <table class="ws-lb-table">
      <thead>
        <tr>
          <th class="ws-lb-col-rank">#</th>
          <th class="ws-lb-col-team">Đội</th>
          <th class="ws-lb-col-time">Thời gian</th>
          <th class="ws-lb-col-score">Điểm</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${total > entries.length ? `<p class="ws-lb-foot">Hiển thị ${entries.length} / ${total} đội</p>` : ''}`;
}

function rowHtml(e) {
  const isTop = e.rank <= 3;
  const rankCell = isTop
    ? `<span class="ws-lb-medal" aria-label="Hạng ${e.rank}">${MEDALS[e.rank - 1]}</span>`
    : `<span class="ws-lb-rank-num">${e.rank}</span>`;
  return `
    <tr class="ws-lb-row ws-lb-rank-${isTop ? e.rank : 'n'}">
      <td class="ws-lb-col-rank">${rankCell}</td>
      <td class="ws-lb-col-team">${escapeHtml(e.teamDisplay)}</td>
      <td class="ws-lb-col-time">${formatTime(e.solveTimeSeconds)}</td>
      <td class="ws-lb-col-score">${e.score}</td>
    </tr>`;
}

function formatTime(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
