import '../../../../css/34-bpa-workshop.css';
import { leaderboardApi } from '../../api/leaderboardApi.js';
import { escapeHtml } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';
import { tr } from '../../services/i18n.js';
import { leaderboardTableHtml, teamNames, teamMonogram, formatTime } from './leaderboardTable.js';
import { fmtDate, fmtInt } from './caseOfWeekBanner.js';

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
  { key: 'fastest', label: () => tr('Fastest solve', 'Phá nhanh nhất'), icon: 'timer' },
  { key: 'topScore', label: () => tr('Top score', 'Top điểm'), icon: 'star' },
];

const ICONS = {
  timer: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M9.5 3h5M12 3v3"/></svg>',
  star: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96z"/></svg>',
};

export async function renderLeaderboardSection(caseId, mount) {
  if (!mount) return;
  const state = { caseId, mount, metric: 'fastest', flip: false, loads: 0 };
  mount.classList.add('bpa-wsc-lbmount');
  renderShell(state);
  await load(state);
}

async function load(state) {
  const seq = ++state.loads;
  setBody(state, `<p class="bpa-wsc-loading" role="status">${tr('Loading leaderboard…', 'Đang tải bảng xếp hạng…')}</p>`, null, false);

  let board;
  try {
    board = await leaderboardApi.get(state.caseId, state.metric);
  } catch (err) {
    if (seq !== state.loads) return;
    toast(err.message || tr('Could not load the leaderboard.', 'Không tải được bảng xếp hạng.'), 'error');
    setBody(state, `<p class="bpa-wsc-error" role="status">${tr('Could not load the leaderboard.', 'Không tải được bảng xếp hạng.')}</p>`, null, true);
    return;
  }
  if (seq !== state.loads) return; // a newer metric was picked meanwhile
  const caption = state.metric === 'topScore'
    ? tr('Teams with the highest score on this case', 'Các đội đạt điểm cao nhất trong vụ án này')
    : tr('Teams with the fastest solve on this case', 'Các đội phá án nhanh nhất trong vụ án này');
  setBody(state, leaderboardTableHtml(board, { marks: 'medal', caption }), board, true);
}

function renderShell(state) {
  state.mount.innerHTML = `
    <div class="bpa-wsc-lb">
      <section class="bpa-wsc-ledger" aria-labelledby="wsc-lb-h">
        <span class="bpa-wsc-dmargin" aria-hidden="true"></span>
        <span class="bpa-pin" aria-hidden="true"></span>
        <div class="bpa-wsc-lbhead">
          <div>
            <p class="bpa-kicker bpa-wsc-kick" data-lb-kick></p>
            <h3 id="wsc-lb-h" class="bpa-wsc-h3">${tr('Leaderboard', 'Bảng xếp hạng')}</h3>
          </div>
          <div class="bpa-wsc-segs" role="group" aria-label="${tr('Rank by', 'Xếp hạng theo')}">
            ${METRICS.map((m) => `
              <button type="button" class="bpa-seg bpa-wsc-seg" data-metric="${m.key}"
                aria-pressed="${m.key === state.metric}">${ICONS[m.icon]}<span>${escapeHtml(m.label())}</span></button>`).join('')}
          </div>
        </div>
        <div class="bpa-wsc-lbbody"></div>
      </section>
      <div class="bpa-wsc-lbside" data-lb-side hidden></div>
    </div>`;

  state.mount.querySelectorAll('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.metric;
      if (next === state.metric) return;
      state.metric = next;
      syncShell(state);
      load(state);
    });
  });
  syncShell(state);
}

function syncShell(state) {
  state.mount.querySelectorAll('[data-metric]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric));
  });
  const kick = state.mount.querySelector('[data-lb-kick]');
  if (kick) {
    const current = METRICS.find((m) => m.key === state.metric);
    kick.textContent = `${tr('Gold ledger', 'Sổ vàng')} · ${current ? current.label() : ''}`;
  }
}

function setBody(state, html, board, animate) {
  const body = state.mount.querySelector('.bpa-wsc-lbbody');
  if (!body) return;
  body.innerHTML = html;
  if (animate) {
    state.flip = !state.flip;
    body.classList.remove('bpa-wipe-a', 'bpa-wipe-b');
    body.classList.add(state.flip ? 'bpa-wipe-b' : 'bpa-wipe-a');
  }
  const side = state.mount.querySelector('[data-lb-side]');
  if (!side) return;
  const leader = board?.entries?.[0];
  if (!leader) {
    if (board) { side.hidden = true; side.innerHTML = ''; }
    return;
  }
  side.hidden = false;
  side.innerHTML = recordCardHtml(leader, board, state.metric);
}

/** Dark "record holder" card next to the ledger: the #1 team for the selected metric. */
function recordCardHtml(leader, board, metric) {
  const names = teamNames(leader.teamDisplay);
  const monos = names.length ? names.slice(0, 2) : [''];
  const duo = monos.length === 2
    ? `<span class="bpa-avatar bpa-wsc-bmono">${escapeHtml(teamMonogram(monos[0]))}</span>
       <svg viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true"><path d="M0 13Q60 31 120 13" transform="translate(1.5 4)" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="2.8" vector-effect="non-scaling-stroke"/><path d="M0 13Q60 31 120 13" fill="none" stroke="#bf3b2c" stroke-width="2.1" vector-effect="non-scaling-stroke"/></svg>
       <span class="bpa-avatar bpa-wsc-bmono">${escapeHtml(teamMonogram(monos[1]))}</span>`
    : `<span class="bpa-avatar bpa-wsc-bmono">${escapeHtml(teamMonogram(monos[0]))}</span>`;
  const label = names.length ? names.map(escapeHtml).join(' &amp; ') : tr('Anonymous team', 'Đội ẩn danh');
  const total = board.totalRanked || board.entries.length;
  const date = fmtDate(leader.completedAt);
  return `
    <section class="bpa-wsc-record" aria-labelledby="wsc-rec-h">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <p class="bpa-kicker bpa-wsc-kick bpa-wsc-kick--gold">${tr('Case record', 'Kỷ lục · vụ này')}</p>
      <h3 id="wsc-rec-h" class="bpa-wsc-h3 bpa-wsc-h3--light">${tr('Leading team', 'Đội dẫn đầu')}</h3>
      <div class="bpa-wsc-duo${monos.length === 2 ? '' : ' bpa-wsc-duo--solo'}" aria-hidden="true">${duo}</div>
      <p class="bpa-wsc-duoname">${label}</p>
      <div class="bpa-wsc-rankrow">
        <p class="bpa-wsc-rankbig"><span class="bpa-sr">${tr('Rank', 'Hạng')} </span>#1</p>
        <p class="bpa-wsc-rankof">${tr(`of ${fmtInt(total)} teams`, `trên ${fmtInt(total)} đội`)}</p>
      </div>
      <dl class="bpa-wsc-mtiles">
        <div class="${metric === 'fastest' ? 'is-on' : ''}"><dt>${tr('Time', 'Thời gian')}</dt><dd>${formatTime(leader.solveTimeSeconds)}</dd></div>
        <div class="${metric === 'topScore' ? 'is-on' : ''}"><dt>${tr('Score', 'Điểm')}</dt><dd>${escapeHtml(String(leader.score ?? '—'))}</dd></div>
      </dl>
      ${date ? `<p class="bpa-wsc-gapnote">${tr(`Solved on ${date}.`, `Phá án ngày ${date}.`)}</p>` : ''}
    </section>`;
}
