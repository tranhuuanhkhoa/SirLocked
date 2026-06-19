import { leaderboardApi } from '../../api/leaderboardApi.js';
import { escapeHtml } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';
import { leaderboardTableHtml } from './leaderboardTable.js';

/**
 * Standalone leaderboard widget for a case. Self-contained:
 *
 *   import { renderLeaderboardSection } from './pages/workshop/leaderboardSection.js';
 *   renderLeaderboardSection(caseId, document.querySelector('#leaderboard-mount'));
 *
 * Read-only: shows the top teams who solved the case, by fastest first-solve or by score.
 * The table markup lives in leaderboardTable.js (shared with the weekly challenge page).
 */

const METRICS = [
  { key: 'fastest', label: 'Phá nhanh nhất' },
  { key: 'topScore', label: 'Top điểm' },
];

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
  renderShell(state, leaderboardTableHtml(board));
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
