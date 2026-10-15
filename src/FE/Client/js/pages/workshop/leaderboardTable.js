import '../../../../css/34-bpa-workshop.css';
import { escapeHtml, initials } from '../../utils/dom.js';
import { tr, plural } from '../../services/i18n.js';
import { fmtInt } from './caseOfWeekBanner.js';

/**
 * Shared leaderboard table renderer, reused by the per-case leaderboard section (Phase 3) and the
 * weekly challenge page (Phase 5) so the table markup lives in one place.
 * The top 3 get a drawn mark instead of a number: a ribbon medal (default) or a wax seal
 * (`{ marks: 'seal' }`, weekly challenge). Teams show as initials monograms, never portraits.
 *
 * The metric-specific column follows board.metric: "topScore" shows only Điểm, anything else
 * (default "fastest") shows only Thời gian — never both.
 */

const BACKEND_ANON_TEAM = 'Đội ẩn danh';

export function leaderboardTableHtml(board, { marks = 'medal', caption = '', record = true } = {}) {
  const entries = board?.entries || [];
  if (entries.length === 0) {
    return `
      <p class="bpa-lb-empty">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H5a2.5 2.5 0 0 0 2.9 3.9"/><path d="M16.5 6H19a2.5 2.5 0 0 1-2.9 3.9"/><path d="M12 13.5v3"/><path d="M8.5 20h7l-1-3.5h-5z"/></svg>
        <span>${tr('No team has solved it yet — be the first!', 'Chưa đội nào phá án — hãy là đội đầu tiên!')}</span>
      </p>`;
  }

  const isTopScore = board?.metric === 'topScore';
  const metricHead = isTopScore ? tr('Score', 'Điểm') : tr('Time', 'Thời gian');
  const rows = entries.map((e) => rowHtml(e, { isTopScore, marks, record })).join('');
  const total = board.totalRanked || entries.length;
  return `
    <table class="bpa-lb-table${marks === 'seal' ? ' bpa-lb-table--seal' : ''}">
      ${caption ? `<caption class="bpa-sr">${escapeHtml(caption)}</caption>` : ''}
      <colgroup><col class="bpa-lb-c1"><col><col class="bpa-lb-c3"></colgroup>
      <thead>
        <tr>
          <th scope="col" class="bpa-lb-rk"><span aria-hidden="true">#</span><span class="bpa-sr">${tr('Rank', 'Hạng')}</span></th>
          <th scope="col">${tr('Team', 'Đội')}</th>
          <th scope="col" class="bpa-lb-val">${metricHead}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="bpa-lb-foot">${tr(
      `Showing ${fmtInt(entries.length)} / ${fmtInt(total)} ${plural(total, 'team', 'teams')}`,
      `Hiển thị ${fmtInt(entries.length)} / ${fmtInt(total)} đội`,
    )}</p>`;
}

function rowHtml(e, { isTopScore, marks, record }) {
  const isTop = e.rank <= 3;
  const rankCell = isTop
    ? `${marks === 'seal' ? sealSvg(e.rank) : medalSvg(e.rank)}<span class="bpa-sr">${e.rank}</span>`
    : `<span class="bpa-lb-num">${e.rank}</span>`;
  const value = isTopScore
    ? `<span class="bpa-lb-metric">${escapeHtml(String(e.score ?? '—'))}</span>`
    : `<span class="bpa-lb-metric">${formatTime(e.solveTimeSeconds)}</span>`;
  const recordTag = record && e.rank === 1 ? `<span class="bpa-lb-rec">${tr('Record', 'Kỷ lục')}</span>` : '';
  return `
    <tr class="bpa-lb-row${isTop ? ` bpa-lb-row--top bpa-lb-row--r${e.rank}` : ''}">
      <td class="bpa-lb-rk">${rankCell}</td>
      <td>${teamHtml(e.teamDisplay)}</td>
      <td class="bpa-lb-val">${recordTag}${value}</td>
    </tr>`;
}

/** Splits the backend "Alice & Bob" display into names (the anonymous fallback is translated). */
export function teamNames(teamDisplay) {
  const raw = String(teamDisplay || '').trim();
  if (!raw || raw === BACKEND_ANON_TEAM) return [];
  return raw.split(' & ').map((n) => n.trim()).filter(Boolean);
}

export function teamMonogram(name) {
  return name ? initials(name.replace(/[_.]+/g, ' ')) || '?' : '?';
}

/** Monogram pair + names joined by an italic ampersand. */
export function teamHtml(teamDisplay, { monoClass = 'bpa-lb-mono' } = {}) {
  const names = teamNames(teamDisplay);
  if (names.length === 0) {
    return `
      <span class="bpa-lb-team">
        <span class="bpa-lb-pair" aria-hidden="true"><span class="${monoClass} bpa-lb-mono--anon">?</span></span>
        <span class="bpa-lb-names bpa-lb-names--anon">${tr('Anonymous team', 'Đội ẩn danh')}</span>
      </span>`;
  }
  const monos = names.slice(0, 2).map((n) => `<span class="${monoClass}">${escapeHtml(teamMonogram(n))}</span>`).join('');
  const label = names.map((n, i) => (i === 0
    ? `<span class="bpa-lb-n">${escapeHtml(n)}</span>`
    : ` <span class="bpa-lb-n"><i>&amp;</i> ${escapeHtml(n)}</span>`)).join('');
  return `
    <span class="bpa-lb-team">
      <span class="bpa-lb-pair" aria-hidden="true">${monos}</span>
      <span class="bpa-lb-names">${label}</span>
    </span>`;
}

const MEDAL = {
  1: { fill: '#d9b45a', dark: '#5e4a1c' },
  2: { fill: '#c9ced1', dark: '#4a5155' },
  3: { fill: '#c98d57', dark: '#5a3416' },
};

/** Ribbon medal with the rank number (WorkshopCase design). */
export function medalSvg(rank) {
  const c = MEDAL[rank] || MEDAL[1];
  return `
    <svg class="bpa-lb-medal" viewBox="0 0 40 44" width="38" height="42" aria-hidden="true" focusable="false">
      <path d="M13 25L8 41.5l5.6-2.6 3.6 4.6 3.4-13.5z" fill="#9e3f2a"/>
      <path d="M27 25l5 16.5-5.6-2.6-3.6 4.6-3.4-13.5z" fill="#1a2c42"/>
      <circle cx="20" cy="17" r="15.5" fill="${c.fill}" stroke="${c.dark}" stroke-width="1.6"/>
      <circle cx="20" cy="17" r="11.5" fill="none" stroke="${c.dark}" stroke-width="1" stroke-dasharray="1.4 2" opacity=".7"/>
      <path d="M9.5 11.5a12 12 0 0 1 8.5-6.6" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="2" stroke-linecap="round"/>
      <text x="20" y="22.5" fill="${c.dark}" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-size="16" font-weight="700">${rank}</text>
    </svg>`;
}

const SEAL = {
  1: { stops: ['#fff3c9', '#dcbb62', '#a9862f', '#6d5420'], ring: 'rgba(74,58,20,.55)', hi: 'rgba(255,243,201,.6)', ink: '#4a3a14' },
  2: { stops: ['#ffffff', '#d3d9dc', '#8f989e', '#545c62'], ring: 'rgba(40,46,50,.5)', hi: 'rgba(255,255,255,.7)', ink: '#2b3135' },
  3: { stops: ['#ffd9b8', '#cf8a58', '#93522a', '#5a2e15'], ring: 'rgba(74,36,16,.55)', hi: 'rgba(255,224,196,.6)', ink: '#4a2412' },
};
let sealSeq = 0;

/** Wax seal with the rank number (Challenge design). */
export function sealSvg(rank, size = 36) {
  const c = SEAL[rank] || SEAL[1];
  sealSeq += 1;
  const gid = `bpa-lb-wax-${rank}-${sealSeq}`;
  return `
    <svg class="bpa-lb-seal" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true" focusable="false">
      <defs><radialGradient id="${gid}" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="${c.stops[0]}"/><stop offset=".4" stop-color="${c.stops[1]}"/><stop offset=".78" stop-color="${c.stops[2]}"/><stop offset="1" stop-color="${c.stops[3]}"/></radialGradient></defs>
      <path d="M35.9 20.0C35.8 22.6 37.4 25.8 36.4 27.9C35.5 30.1 32.4 31.4 30.3 32.9C28.2 34.4 26.2 36.4 23.9 36.9C21.5 37.4 19.1 36.0 16.4 35.7C13.7 35.5 9.5 36.9 7.7 35.4C6.0 33.9 7.0 29.3 6.0 26.7C5.1 24.2 2.1 22.2 2.1 20.0C2.1 17.8 4.9 15.6 6.1 13.3C7.2 11.0 7.1 7.5 8.9 6.1C10.6 4.7 14.1 5.4 16.5 4.9C19.0 4.4 21.6 2.6 23.9 3.1C26.1 3.5 27.9 6.0 30.0 7.5C32.1 9.0 35.5 10.0 36.5 12.0C37.5 14.1 35.9 17.4 35.9 20.0Z" fill="url(#${gid})" stroke="${c.stops[3]}" stroke-width=".8"/>
      <circle cx="20" cy="20" r="11.2" fill="none" stroke="${c.ring}" stroke-width="1.3"/>
      <circle cx="20.7" cy="20.7" r="11.2" fill="none" stroke="${c.hi}" stroke-width=".7"/>
      <text x="20" y="24.6" fill="${c.ink}" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-size="15" font-weight="700">${rank}</text>
    </svg>`;
}

export function formatTime(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
