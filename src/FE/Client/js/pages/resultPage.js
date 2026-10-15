import '../../../css/35-bpa-result.css';
import { gameApi } from '../api/gameApi.js';
import { escapeHtml, initials, render } from '../utils/dom.js';
import { plural, tr, uiLanguage } from '../services/i18n.js';
import { session } from '../services/session.js';
import { CutsceneController } from '../game/cutsceneController.js';

/* Rank ladder used by the backend (GameplayV2Rules.BuildScoreSummary): S ≥ 90, A ≥ 75, B ≥ 60, else C.
   A failed accusation always ranks D. */
const RANK_ZONES = [
  { rank: 'C', from: 0, to: 60 },
  { rank: 'B', from: 60, to: 75 },
  { rank: 'A', from: 75, to: 90 },
  { rank: 'S', from: 90, to: 100 },
];
// [highlight, mid, shadow, letter, ladder fill]
const WAX = {
  S: ['#fff1c2', '#c7a24b', '#5e4a1c', '#3a2c0c', 'rgba(199, 162, 75, .6)'],
  A: ['#8fcdc8', '#2f6f6c', '#103030', '#e3f3f1', 'rgba(79, 154, 154, .6)'],
  B: ['#8aa6c8', '#1f3a5a', '#0a1420', '#e6eef8', 'rgba(70, 110, 160, .6)'],
  C: ['#e3a07d', '#8a4429', '#2e140a', '#fbe3d6', 'rgba(196, 98, 63, .62)'],
  D: ['#b9b1a5', '#58504a', '#1d1a17', '#f3ede3', 'rgba(150, 140, 128, .5)'],
};

const ICON_OK = '<svg class="bpa-result-ic" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M7.6 12.4l3 3 5.8-6.4"/></g></svg>';
const ICON_BAD = '<svg class="bpa-result-ic" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8"/></g></svg>';
const ICON_FLAG_ON = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M7.6 12.4l3 3 5.8-6.4"/></g></svg>';
const ICON_FLAG_OFF = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/></svg>';
const ICON_BACK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>';
const ICON_REPLAY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v4.2h4.2"/></svg>';
const ICON_STAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.8l2.5 5.1 5.6.8-4.05 3.95.96 5.6L12 16.6l-5.01 2.65.96-5.6L3.9 9.7l5.6-.8z"/></svg>';
const ICON_CLIP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 8.5l-7.4 7.4a2.2 2.2 0 0 1-3.1-3.1l7.8-7.8a3.6 3.6 0 0 1 5.1 5.1l-8.2 8.2a5 5 0 0 1-7.1-7.1l7-7"/></svg>';

/** Newspaper "line-up" photo of the accused: a faceless silhouette, never a portrait. */
function lineupPhoto(name) {
  const marks = [180, 170, 160, 150].map((cm, index) => {
    const y = 26 + index * 34;
    return `<path d="M0 ${y}H320" stroke="rgba(236,224,178,.32)" stroke-width="1.2"/><text x="10" y="${y - 5}" class="bpa-result-photo-cm">${cm}</text><text x="310" y="${y - 5}" class="bpa-result-photo-cm" text-anchor="end">${cm}</text>`;
  }).join('');
  return `<svg class="bpa-result-photo-art" viewBox="0 0 320 190" aria-hidden="true">
    <defs>
      <radialGradient id="bpa-result-ph-bg" cx=".5" cy=".42" r=".78"><stop offset="0" stop-color="#6a6052"/><stop offset=".6" stop-color="#3a3229"/><stop offset="1" stop-color="#1b1713"/></radialGradient>
      <radialGradient id="bpa-result-ph-rim" cx=".5" cy=".3" r=".7"><stop offset="0" stop-color="#2a241e"/><stop offset="1" stop-color="#0d0a08"/></radialGradient>
      <pattern id="bpa-result-ph-ht" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="1.6" cy="1.6" r=".72" fill="rgba(10,8,6,.3)"/></pattern>
    </defs>
    <rect width="320" height="190" fill="url(#bpa-result-ph-bg)"/>
    ${marks}
    <g fill="url(#bpa-result-ph-rim)" stroke="rgba(239,212,134,.18)" stroke-width="1.2">
      <path d="M160 40c-17 0-29 13-29 30 0 12 6 23 15 28l-2 9c-26 4-50 14-58 36-4 11-5 31-5 47h158c0-16-1-36-5-47-8-22-32-32-58-36l-2-9c9-5 15-16 15-28 0-17-12-30-29-30z"/>
    </g>
    <g transform="translate(118 150)">
      <rect width="84" height="28" fill="#e7e0d0" stroke="rgba(0,0,0,.25)"/>
      <text x="42" y="19" class="bpa-result-photo-plate">${escapeHtml(initials(name))}</text>
    </g>
    <g transform="translate(272 156)"><path d="M0 16L6 0H20L26 16Z" fill="#ece0b2" stroke="#1b1713"/><text x="13" y="12.5" class="bpa-result-photo-tag">1</text></g>
    <rect width="320" height="190" fill="url(#bpa-result-ph-ht)"/>
  </svg>`;
}

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const pct = (value, max) => Math.max(0, Math.min(100, (num(value) / max) * 100));

const claimLabel = (claimType) => ({
  CULPRIT: tr('Culprit', 'Hung thủ'),
  MOTIVE: tr('Motive', 'Động cơ'),
  METHOD: tr('Method', 'Phương thức'),
  OPPORTUNITY: tr('Opportunity', 'Cơ hội'),
  IDENTITY: tr('Identity', 'Danh tính'),
  TIMELINE: tr('Timeline', 'Dòng thời gian'),
})[claimType] || claimType || tr('Claim', 'Luận điểm');

const evidenceClaimLabel = (claimType) => tr(`${claimLabel(claimType)} evidence`, `${claimLabel(claimType)} chứng cứ`);

/** Completion date for the masthead; legacy records may carry DateTime.MinValue. */
function completedDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000) return null;
  const locale = uiLanguage() === 'vi' ? 'vi-VN' : 'en-GB';
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
  const day = uiLanguage() === 'vi'
    ? `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`
    : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return { masthead: `${weekday} · ${day}`, time, iso: date.toISOString() };
}

function rankSeal(rank) {
  const wax = WAX[rank] || WAX.D;
  const letter = escapeHtml(rank);
  return `<svg class="bpa-result-seal" viewBox="0 0 120 120" role="img" aria-label="${escapeHtml(tr(`Rank ${rank}`, `Hạng ${rank}`))}">
    <defs>
      <radialGradient id="bpa-result-wax" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="${wax[0]}"/><stop offset=".52" stop-color="${wax[1]}"/><stop offset="1" stop-color="${wax[2]}"/></radialGradient>
      <radialGradient id="bpa-result-wax-in" cx=".62" cy=".68" r=".75"><stop offset="0" stop-color="${wax[1]}"/><stop offset="1" stop-color="${wax[2]}"/></radialGradient>
    </defs>
    <path d="M113.5 60C114.1 62.7 113.7 65.8 112.7 68.3C111.6 70.9 108.4 72.9 107 75.3C105.6 77.6 105.2 80.1 104.2 82.5C103.2 84.9 102.6 87.8 100.9 89.7C99.2 91.6 96.2 92.6 94.1 94.1C91.9 95.6 90.1 97.1 88.1 98.7C86.1 100.2 84.3 102.1 82.1 103.5C80 104.9 77.6 105.6 75.3 107.1C73 108.7 70.9 111.5 68.4 112.8C65.8 114.1 62.7 115.5 60 114.9C57.3 114.3 54.6 110.9 52.2 109.1C49.8 107.3 47.9 105.3 45.6 104.2C43.3 103.1 40.8 103.2 38.4 102.3C36.1 101.5 34 100.2 31.6 99.1C29.2 98 26.5 97.2 24.1 95.9C21.8 94.5 19 93 17.5 90.9C16 88.7 16.1 85.4 15.1 82.9C14.2 80.3 13.2 78 12 75.6C10.8 73.2 8.3 70.8 8 68.2C7.7 65.6 9.1 62.6 10.1 60C11.1 57.4 13.1 55.1 13.9 52.7C14.8 50.3 14.6 47.9 15.1 45.4C15.6 43 16.4 40.7 16.9 38.1C17.5 35.4 17.5 32.5 18.2 29.6C18.9 26.8 19.1 22.9 20.9 20.9C22.8 19 26.5 18.4 29.4 17.8C32.3 17.2 35.7 18.1 38.3 17.4C40.9 16.8 42.7 14.9 45.1 14C47.4 13.1 49.9 12.3 52.4 11.9C54.9 11.5 57.4 11.7 60 11.5C62.6 11.2 65.3 10.2 67.9 10.4C70.4 10.5 73 11.6 75.5 12.3C78 13.1 80.2 14.4 82.9 15.1C85.6 15.7 89.3 15.1 91.7 16.4C94.1 17.7 96.1 20.1 97.3 22.7C98.4 25.4 97.7 29.4 98.4 32.1C99 34.8 100 36.8 101.2 39C102.3 41.2 103.9 43.1 105.2 45.3C106.4 47.5 107.5 49.8 108.9 52.3C110.3 54.7 112.9 57.3 113.5 60Z" fill="url(#bpa-result-wax)"/>
    <circle cx="61" cy="62" r="38" fill="rgba(0,0,0,.28)"/>
    <circle cx="60" cy="60" r="38" fill="url(#bpa-result-wax-in)"/>
    <path d="M27.5 46A36 36 0 0 1 74 26.5" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2" stroke-linecap="round"/>
    <circle cx="60" cy="60" r="31" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1.2" stroke-dasharray="1.4 3.2"/>
    <text x="60" y="41.5" class="bpa-result-seal-kick">${escapeHtml(tr('RANK', 'HẠNG'))}</text>
    <text x="61.4" y="86.4" class="bpa-result-seal-letter" fill="rgba(0,0,0,.4)">${letter}</text>
    <text x="59.2" y="84.2" class="bpa-result-seal-letter" fill="rgba(255,255,255,.34)">${letter}</text>
    <text x="60" y="85" class="bpa-result-seal-letter" fill="${wax[3]}">${letter}</text>
    <ellipse cx="40" cy="27" rx="15" ry="6" transform="rotate(-32 40 27)" fill="rgba(255,255,255,.2)"/>
  </svg>`;
}

function rankLadder(total, rank) {
  const next = RANK_ZONES.find((zone) => zone.from > total);
  const note = rank === 'D'
    ? tr('A failed accusation ranks D', 'Cáo buộc sai luôn xếp hạng D')
    : next
      ? tr(`${next.from - total} ${plural(next.from - total, 'point', 'points')} to rank ${next.rank}`, `Còn ${next.from - total} điểm tới Hạng ${next.rank}`)
      : tr('Top rank', 'Hạng cao nhất');
  const label = tr(
    `Rank ladder: C below 60, B from 60, A from 75, S from 90. The team scored ${total}, rank ${rank}.`,
    `Thang hạng: C dưới 60, B từ 60, A từ 75, S từ 90. Đội đạt ${total} điểm, hạng ${rank}.`,
  );
  return `<div class="bpa-result-ruler" style="--bpa-result-zone: ${(WAX[rank] || WAX.D)[4]}">
    <div class="bpa-result-rulerhead"><span class="bpa-result-mini is-muted">${tr('Rank ladder', 'Thang hạng')}</span><span class="bpa-result-next">${escapeHtml(note)}</span></div>
    <div class="bpa-result-track" role="img" aria-label="${escapeHtml(label)}">
      ${RANK_ZONES.map((zone) => `<span class="bpa-result-zone${zone.rank === rank ? ' is-on' : ''}" style="width: ${zone.to - zone.from}%">${zone.from ? `<b>${zone.from}</b>` : ''}<i>${zone.rank}</i></span>`).join('')}
      <span class="bpa-result-mark" style="--bpa-result-at: ${Math.max(0, Math.min(100, total))}%"></span>
    </div>
  </div>`;
}

function scorePanel(score, win, motionOk) {
  const heading = `<div class="bpa-result-perfhead">
      <p class="bpa-kicker bpa-result-kick is-gold">${tr('Performance', 'Hiệu suất')}</p>
      <h2 id="bpa-result-perf-h" class="bpa-h2 bpa-result-h2 is-light">${tr('Detective score', 'Điểm điều tra')}</h2>
    </div>`;
  if (!score) {
    return `${heading}<p class="bpa-result-empty">${tr('No score summary was recorded for this case.', 'Vụ án này không có bảng điểm.')}</p>`;
  }
  const total = Math.max(0, Math.min(100, num(score.totalScore)));
  const rank = String(score.rank || '').trim().toUpperCase()
    || (!win ? 'D' : total >= 90 ? 'S' : total >= 75 ? 'A' : total >= 60 ? 'B' : 'C');
  const bars = [
    [tr('Evidence', 'Chứng cứ'), score.evidenceCoverageScore, 40],
    [tr('Contradictions', 'Mâu thuẫn'), score.contradictionCoverageScore, 25],
    [tr('Deductions', 'Suy luận'), score.deductionCoverageScore, 20],
    [tr('Teamwork', 'Phối hợp'), score.teamworkScore, 15],
  ];
  const raw = bars.reduce((sum, bar) => sum + num(bar[1]), 0);
  const penalties = [
    [score.wrongEvidencePenalty, tr('wrong evidence', 'chứng cứ sai')],
    [score.wrongDeductionPenalty, tr('wrong deductions', 'suy luận sai')],
    [score.cameraMissPenalty, tr('camera misses', 'lần chụp trượt')],
  ].filter(([value]) => num(value) > 0);
  const penaltyTotal = penalties.reduce((sum, [value]) => sum + num(value), 0);
  const equationHolds = raw - penaltyTotal === total;
  const flags = [
    [score.investigatorContribution, tr('Investigator', 'Điều tra viên')],
    [score.interrogatorContribution, tr('Interrogator', 'Thẩm vấn viên')],
    [score.crossRoleHandoff, tr('Handoff', 'Phối hợp')],
  ];
  return `${heading}
    <div class="bpa-result-scorerow">
      <p class="bpa-result-score">
        <span class="bpa-result-num" aria-hidden="true" data-score-count="${total}" style="min-width: ${String(total).length}ch">${motionOk ? 0 : total}</span>
        <span class="bpa-sr">${escapeHtml(tr(`${total} points out of 100`, `${total} điểm trên 100`))}</span>
        <span class="bpa-result-unit" aria-hidden="true"><span class="bpa-result-mini is-gold">${tr('Points', 'Điểm')}</span><span class="bpa-result-mini is-muted">/ 100</span></span>
      </p>
      ${rankSeal(rank)}
    </div>
    ${rankLadder(total, rank)}
    <h3 class="bpa-result-mini is-gold bpa-result-barsh">${tr('Score breakdown', 'Thành phần điểm')}</h3>
    <ul class="bpa-result-bars">
      ${bars.map(([label, value, max], index) => `<li class="bpa-result-bar">
        <span class="bpa-result-bartop"><span class="bpa-result-barname">${escapeHtml(label)}</span><span class="bpa-result-barval${num(value) === 0 ? ' is-zero' : ''}">${num(value)}/${max}</span></span>
        <span class="bpa-result-bartrack" aria-hidden="true"><span class="bpa-result-fill" style="width: ${pct(value, max).toFixed(1)}%; --i: ${index}"></span></span>
      </li>`).join('')}
    </ul>
    <div class="bpa-result-pen">
      <div class="bpa-result-penhead">
        <h3 class="bpa-result-mini is-muted">${tr('Penalties', 'Điểm trừ')}</h3>
        ${equationHolds ? `<span class="bpa-result-eq"><span aria-hidden="true">${raw} − ${penaltyTotal} = ${total}</span><span class="bpa-sr">${escapeHtml(tr(`Components ${raw}, minus ${penaltyTotal}, leaves ${total} points.`, `Tổng điểm thành phần ${raw}, trừ ${penaltyTotal}, còn ${total} điểm.`))}</span></span>` : ''}
      </div>
      <div class="bpa-result-penchips">
        ${penalties.length
    ? penalties.map(([value, label]) => `<span class="bpa-result-penchip">−${num(value)} ${escapeHtml(label)}</span>`).join('')
    : `<span class="bpa-result-penchip is-none">${tr('No penalties', 'Không bị trừ điểm')}</span>`}
      </div>
    </div>
    <ul class="bpa-result-flags" aria-label="${tr('Team contribution', 'Đóng góp của đội')}">
      ${flags.map(([on, label]) => `<li class="bpa-result-flag${on ? '' : ' is-off'}">${on ? ICON_FLAG_ON : ICON_FLAG_OFF}${escapeHtml(label)}<span class="bpa-sr">${on ? tr(', earned', ', đạt') : tr(', not earned', ', chưa đạt')}</span></li>`).join('')}
    </ul>`;
}

function verdictRow(label, entry, index) {
  const ok = Boolean(entry.isCorrect);
  const answer = entry.selectedLabel || entry.selectedEvidenceTitle || tr('Not supplied', 'Chưa cung cấp');
  const truth = entry.correctLabel || entry.correctEvidenceTitle || '';
  return `<li class="bpa-result-row ${ok ? 'is-ok' : 'is-bad'}">
    ${ok ? ICON_OK : ICON_BAD}
    <span class="bpa-result-rk">${escapeHtml(label)}</span>
    <span class="bpa-result-tick ${ok ? 'is-ok' : 'is-bad'}" style="--i: ${index}">${ok ? tr('Correct', 'Chính xác') : tr('Wrong', 'Sai')}</span>
    <p class="bpa-result-ra"><span class="bpa-result-q">${tr('Your answer:', 'Câu trả lời:')}</span> <span class="bpa-result-av">${escapeHtml(answer)}</span>${ok || !truth ? '' : ` <span class="bpa-result-truth"><span class="bpa-result-arrow" aria-hidden="true">→</span><b>${tr('Truth:', 'Sự thật:')}</b> <span>${escapeHtml(truth)}</span></span>`}</p>
  </li>`;
}

function verdictPanel(result) {
  const claims = [
    [tr('Culprit', 'Hung thủ'), result.culpritResult],
    [tr('Motive', 'Động cơ'), result.motiveResult],
    [tr('Method', 'Phương thức'), result.methodResult],
  ].filter(([, entry]) => entry);
  const evidence = (Array.isArray(result.evidenceResults) ? result.evidenceResults : []).filter(Boolean);
  const all = [...claims.map(([, entry]) => entry), ...evidence];
  const correct = all.filter((entry) => entry.isCorrect).length;
  const column = (title, rows) => `<div class="bpa-result-col">
      <h3 class="bpa-result-mini bpa-result-colh">${title}</h3>
      <ol class="bpa-result-rows">${rows.join('')}</ol>
    </div>`;
  const cols = [];
  if (claims.length) cols.push(column(tr('Claims', 'Luận điểm'), claims.map(([label, entry], index) => verdictRow(label, entry, index))));
  if (evidence.length) cols.push(column(tr('Evidence for each claim', 'Chứng cứ cho từng luận điểm'), evidence.map((entry, index) => verdictRow(evidenceClaimLabel(entry.claimType), entry, claims.length + index))));
  return `<section class="bpa-paper bpa-paper--ledger bpa-result-ana result-verdict-panel" aria-labelledby="bpa-result-ana-h">
    <span class="bpa-pin" aria-hidden="true"></span>
    <div class="bpa-result-anahead">
      <div>
        <p class="bpa-kicker bpa-result-kick">${tr('Case review', 'Tổng kết vụ án')}</p>
        <h2 id="bpa-result-ana-h" class="bpa-h2 bpa-result-h2">${tr('Accusation breakdown', 'Phân tích cáo buộc')}</h2>
      </div>
      <p class="bpa-result-tally">
        <span class="bpa-result-dots" aria-hidden="true">${all.map((entry) => `<span class="bpa-result-dot${entry.isCorrect ? '' : ' is-bad'}"></span>`).join('')}</span>
        <span class="bpa-result-mini bpa-result-tallytext">${escapeHtml(tr(`${correct} / ${all.length} correct`, `${correct} / ${all.length} chính xác`))}</span>
      </p>
    </div>
    <div class="bpa-result-cols verdict-breakdown${cols.length > 1 ? ' is-split' : ''}">${cols.join('')}</div>
  </section>`;
}

const TAG_TILT = [-2, 1.6, -1.2, 2, -1.8, 1.4];

/** The truth's key evidence, one kraft tag per claim hung on a red string (gold pin = you found it, red = missed). */
function evidenceTags(entries) {
  if (!entries.length) return '';
  const count = entries.length;
  const width = 1200;
  const centres = entries.map((_, index) => ((index + .5) * width) / count);
  let path = `M0 4Q${(centres[0] / 2).toFixed(1)} 12 ${centres[0].toFixed(1)} 14`;
  for (let index = 1; index < count; index++) path += `Q${((centres[index - 1] + centres[index]) / 2).toFixed(1)} 28 ${centres[index].toFixed(1)} 14`;
  path += `Q${((centres[count - 1] + width) / 2).toFixed(1)} 12 ${width} 4`;
  const found = entries.filter((entry) => entry.isCorrect).length;
  return `<div class="bpa-result-tags">
    <div class="bpa-result-tlhead">
      <h3 class="bpa-result-mini is-gold">${tr('Key evidence', 'Chứng cứ then chốt')}</h3>
      <span class="bpa-result-mini is-muted">${escapeHtml(tr(`You found ${found} / ${count}`, `Bạn tìm đúng ${found} / ${count}`))}</span>
    </div>
    <div class="bpa-result-tlwrap" style="--n: ${count}">
      <svg class="bpa-result-tlstr" viewBox="0 0 ${width} 30" preserveAspectRatio="none" aria-hidden="true">
        <path class="bpa-result-string bpa-string bpa-string--shadow" pathLength="1" d="${path}"/>
        <path class="bpa-result-string bpa-string" pathLength="1" d="${path}"/>
      </svg>
      <ol class="bpa-result-tl">
        ${entries.map((entry, index) => `<li class="bpa-result-ev${entry.isCorrect ? '' : ' is-missed'}" style="--i: ${index}">
          <span class="bpa-result-tpin" aria-hidden="true"></span><span class="bpa-result-thread" aria-hidden="true"></span>
          <div class="bpa-result-tag"><div class="bpa-result-tagin" style="--tilt: ${TAG_TILT[index % TAG_TILT.length]}deg">
            <span class="bpa-result-hole" aria-hidden="true"></span>
            <span class="bpa-result-tchip">${escapeHtml(claimLabel(entry.claimType))}</span>
            <p class="bpa-result-ttext">${escapeHtml(entry.correctEvidenceTitle)}</p>
            <span class="bpa-sr">${entry.isCorrect ? tr('(you presented it)', '(bạn đã trình đúng)') : tr('(you missed it)', '(bạn đã bỏ lỡ)')}</span>
          </div></div>
        </li>`).join('')}
      </ol>
    </div>
  </div>`;
}

function comparison(result, win) {
  const yourName = result.selectedCulpritName || result.selectedCulpritId || '';
  const truthName = result.correctCulpritName || result.correctCulpritId || '';
  if (!yourName && !truthName) return '';
  const evidenceResults = Array.isArray(result.evidenceResults) ? result.evidenceResults : [];
  const evidence = evidenceResults.filter((entry) => entry && entry.selectedEvidenceTitle);
  const keyEvidence = evidenceResults.filter((entry) => entry && entry.correctEvidenceTitle);
  const presented = evidence.length || (Array.isArray(result.selectedEvidenceIds) ? result.selectedEvidenceIds.length : 0);
  const match = result.culpritResult
    ? Boolean(result.culpritResult.isCorrect)
    : result.selectedCulpritId && result.correctCulpritId ? result.selectedCulpritId === result.correctCulpritId : Boolean(win);
  const claim = (label, value) => (value ? `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>` : '');
  const yourClaims = claim(tr('Motive:', 'Động cơ:'), result.motiveResult?.selectedLabel) + claim(tr('Method:', 'Phương thức:'), result.methodResult?.selectedLabel);
  const truthClaims = claim(tr('Motive:', 'Động cơ:'), result.motive) + claim(tr('Method:', 'Phương thức:'), result.method);
  const suspect = (name) => (name
    ? `<div class="bpa-result-suspect"><span class="bpa-avatar bpa-avatar--lg bpa-result-mono" aria-hidden="true">${escapeHtml(initials(name))}</span><span class="bpa-result-sname">${escapeHtml(name)}</span></div>`
    : `<p class="bpa-result-empty">${tr('Not recorded', 'Không có dữ liệu')}</p>`);
  return `<div class="result-comparison bpa-result-pair" role="group" aria-label="${tr('Accusation compared with the truth', 'So sánh cáo buộc và sự thật')}">
    <section class="bpa-paper bpa-paper--card bpa-result-yours" aria-labelledby="bpa-result-yours-h">
      <span class="bpa-pin" aria-hidden="true"></span>
      <span class="bpa-pin bpa-pin--red bpa-result-edge is-right" aria-hidden="true"></span>
      <div class="bpa-result-cardhead"><h2 id="bpa-result-yours-h" class="bpa-result-label2">${tr('Your accusation', 'Cáo buộc của bạn')}</h2></div>
      ${suspect(yourName)}
      ${yourClaims ? `<dl class="bpa-result-claims">${yourClaims}</dl>` : ''}
      <div class="bpa-result-evid">
        <p class="bpa-result-evk">${ICON_CLIP}${escapeHtml(tr(`${presented} ${plural(presented, 'piece', 'pieces')} of evidence presented`, `${presented} chứng cứ đã trình bày`))}</p>
        ${evidence.length ? `<ul class="bpa-result-evlist">${evidence.map((entry) => `<li><span class="bpa-result-evc">${escapeHtml(claimLabel(entry.claimType))}</span><span>${escapeHtml(entry.selectedEvidenceTitle)}</span></li>`).join('')}</ul>` : ''}
      </div>
    </section>
    <div class="bpa-result-link">
      <svg viewBox="0 0 64 40" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 20Q32 32 64 20" transform="translate(2 5)" class="bpa-string bpa-string--shadow"/>
        <path d="M0 20Q32 32 64 20" class="bpa-string"/>
      </svg>
      <span class="bpa-result-vs${match ? '' : ' is-bad'}"><span aria-hidden="true">${match ? '=' : '≠'}</span><span class="bpa-sr">${match ? tr('The accusation matches the truth', 'Cáo buộc khớp với sự thật') : tr('The accusation does not match the truth', 'Cáo buộc không khớp với sự thật')}</span></span>
    </div>
    <section class="bpa-panel bpa-result-truthc" aria-labelledby="bpa-result-truth-h">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <span class="bpa-pin bpa-pin--red bpa-result-edge is-left" aria-hidden="true"></span>
      <div class="bpa-result-cardhead"><h2 id="bpa-result-truth-h" class="bpa-result-label2 is-gold">${tr('The truth', 'Sự thật')}</h2><span class="bpa-result-mini is-muted">${tr('File unsealed', 'Hồ sơ đã mở niêm phong')}</span></div>
      <div class="bpa-result-truthtop">
        ${suspect(truthName)}
        ${truthClaims ? `<dl class="bpa-result-claims">${truthClaims}</dl>` : ''}
      </div>
      ${evidenceTags(keyEvidence)}
    </section>
  </div>`;
}

export async function renderResultPage(app, roomId) {
  render(app, `<div class="bpa-container bpa-result-page bpa-result-status"><p class="bpa-result-loading" role="status">${tr('Loading the verdict…', 'Đang tải phán quyết…')}</p></div>`);

  let result = null;
  const cached = sessionStorage.getItem(`sirlocked.result.${roomId}`);
  if (cached) {
    try {
      result = JSON.parse(cached);
    } catch {
      /* fall through to API */
    }
  }
  if (!result) {
    try {
      result = await gameApi.result(roomId);
    } catch (err) {
      render(app, `<div class="bpa-container bpa-result-page bpa-result-status"><div class="bpa-paper bpa-paper--note bpa-result-error" role="alert">
        <p class="bpa-kicker">${tr('Verdict unavailable', 'Không tải được phán quyết')}</p>
        <p>${escapeHtml(err.message)}</p>
        <a class="bpa-link" href="#/cases">${tr('Back to cases', 'Quay lại danh sách vụ án')}</a>
      </div></div>`);
      return;
    }
  }

  const win = Boolean(result.success);
  const v2 = Boolean(result.culpritResult);
  const score = result.scoreSummary;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionOk = !reduceMotion;
  const date = completedDate(result.completedAt);
  const caseTitle = result.caseTitle || '';
  const [stamp1, stamp2] = win ? tr(['CASE', 'CLOSED'], ['PHÁ ÁN', 'THÀNH CÔNG']) : tr(['CASE', 'COLD'], ['VỤ ÁN', 'BẾ TẮC']);
  const [head1, head2] = win
    ? tr(['The culprit', 'is exposed.'], ['Hung thủ đã bị', 'vạch mặt.'])
    : tr(['The culprit', 'walks free.'], ['Hung thủ vẫn ngoài', 'vòng pháp luật.']);
  const facts = [
    caseTitle ? `<div class="bpa-result-fact"><dt>${tr('Case', 'Vụ án')}</dt><dd class="bpa-result-fname">${escapeHtml(caseTitle)}</dd></div>` : '',
    date ? `<div class="bpa-result-fact"><dt>${tr('File closed', 'Khép hồ sơ')}</dt><dd class="bpa-result-ftime"><time datetime="${date.iso}">${escapeHtml(date.time)}</time></dd></div>` : '',
    Array.isArray(result.selectedEvidenceIds) && result.selectedEvidenceIds.length ? `<div class="bpa-result-fact"><dt>${tr('Evidence shown', 'Chứng cứ nộp')}</dt><dd class="bpa-result-ftime">${result.selectedEvidenceIds.length}</dd></div>` : '',
  ].join('');
  const accused = result.selectedCulpritName || '';
  const caseId = result.caseId ? encodeURIComponent(result.caseId) : '';
  const backToCases = `<a class="bpa-btn ${win ? 'bpa-btn--red' : 'bpa-btn--gold'} bpa-result-fbtn${win ? ' is-first' : ''}" href="#/cases">${ICON_BACK}${tr('Back to cases', 'Quay lại danh sách vụ án')}</a>`;
  const replay = caseId ? `<a class="bpa-btn ${win ? 'bpa-btn--gold' : 'bpa-btn--red is-first'} bpa-result-fbtn" href="#/cases/${caseId}">${ICON_REPLAY}${tr('Play this case again', 'Chơi lại vụ này')}</a>` : '';
  const review = caseId ? `<a class="bpa-btn bpa-btn--gold bpa-result-fbtn" href="#/workshop/${caseId}">${ICON_STAR}${tr('Review the case', 'Đánh giá vụ án')}</a>` : '';

  render(app, `
  <div class="bpa-container bpa-result-page ${win ? 'is-win' : 'is-fail'}${motionOk ? ' is-pending' : ''}">
    <div class="bpa-result-top">
      <div class="bpa-label bpa-result-title">
        <p class="bpa-kicker">${tr('Case result', 'Kết quả vụ án')}</p>
        <h1 class="bpa-result-h1">${caseTitle ? `<span class="bpa-sr">${tr('Case result:', 'Kết quả vụ án:')} </span>${escapeHtml(caseTitle)}` : tr('The verdict', 'Phán quyết')}</h1>
      </div>
      <p class="bpa-result-aside">${win
    ? tr('The file is closed. Review the accusation, the detective score and what really happened.', 'Hồ sơ đã khép lại. Xem lại cáo buộc, điểm điều tra và điều thực sự đã xảy ra.')
    : tr('The accusation did not hold. See where it drifted from the truth, then reopen the file.', 'Cáo buộc không đứng vững. Xem cáo buộc đã lệch khỏi sự thật ở đâu, rồi mở lại hồ sơ.')}</p>
    </div>

    <div class="result-layout bpa-result-hero${score ? '' : ' is-noscore'}">
      <section class="bpa-paper bpa-paper--news bpa-result-news" aria-labelledby="bpa-result-headline">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        <div class="bpa-masthead bpa-result-mast"><span>${tr('The 221B Gazette · Special edition', 'Báo 221B · Số đặc biệt')}</span>${date ? `<span class="bpa-result-date">${escapeHtml(date.masthead)}</span>` : ''}</div>
        ${caseTitle ? `<p class="bpa-kicker bpa-result-newskick">${escapeHtml(tr(`Case: ${caseTitle}`, `Vụ ${caseTitle}`))}</p>` : ''}
        <h2 id="bpa-result-headline" class="bpa-result-headline"><span>${escapeHtml(head1)}</span> <span>${escapeHtml(head2)}</span></h2>
        <div class="bpa-result-stampbox">
          <div class="bpa-result-stamp">
            <div class="bpa-result-stamp-in">
              <span class="bpa-result-stamp-top" aria-hidden="true">${tr('Sir Locked · Bureau', 'Sở điều tra · Sir Locked')}</span>
              <p class="result-banner bpa-result-stamp-main"><span>${escapeHtml(stamp1)}</span> <span>${escapeHtml(stamp2)}</span></p>
            </div>
          </div>
        </div>
        <div class="bpa-result-newsbody${accused ? '' : ' is-single'}">
          ${accused ? `<figure class="bpa-result-photo">
            ${lineupPhoto(accused)}
            <figcaption class="bpa-result-cap">${escapeHtml(tr(`Accused: ${accused}`, `Bị cáo buộc: ${accused}`))}<span class="bpa-result-mini">${tr('Photo: Sir Locked case file', 'Ảnh: hồ sơ Sir Locked')}</span></figcaption>
          </figure>` : ''}
          <div class="bpa-result-newsright">
            <p class="bpa-result-ending">${escapeHtml(result.ending || (win ? tr('The culprit is exposed.', 'Hung thủ đã bị vạch mặt.') : tr('The culprit walks free.', 'Hung thủ vẫn ngoài vòng pháp luật.')))}</p>
            ${facts ? `<dl class="bpa-result-facts">${facts}</dl>` : ''}
          </div>
        </div>
      </section>

      <section class="bpa-panel bpa-result-perf result-score-panel" aria-labelledby="bpa-result-perf-h">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        ${scorePanel(score, win, motionOk)}
      </section>
    </div>

    ${v2 ? verdictPanel(result) : ''}

    ${comparison(result, win)}

    <nav class="bpa-result-foot" aria-label="${tr('What next', 'Bước tiếp theo')}">
      <p class="bpa-result-footnote"><span class="bpa-kicker">${tr('What next', 'Bước tiếp theo')}</span><span>${win
    ? tr('The file is stamped and archived.', 'Hồ sơ đã đóng dấu và lưu kho.')
    : tr('Open the file again and follow the threads you missed.', 'Mở lại hồ sơ và lần theo những sợi dây đã bỏ lỡ.')}</span></p>
      <div class="bpa-result-actions">
        ${backToCases}
        ${replay}
        ${review}
        <a class="bpa-link bpa-link--gold bpa-result-home" href="#/menu">${tr('Back to home', 'Về trang chủ')}</a>
      </div>
    </nav>
  </div>`);

  const page = app.querySelector('.bpa-result-page');
  const cinematicHost = document.createElement('div');
  app.append(cinematicHost);

  /* The verdict plays (stamp slam, score count-up, bars) once the player can actually see the page:
     after the ENDING cutscene closes, after the page-change lens, and while the tab is visible. */
  let revealed = false;
  let disposed = false;
  let rafId = 0;
  const timers = [];
  let lensTarget = null;
  const onLensEnd = (event) => { if (event.target === lensTarget && event.animationName === 'bpaLens') play(); };
  const play = () => {
    if (disposed || !page || page.classList.contains('is-revealed')) return;
    lensTarget?.removeEventListener('animationend', onLensEnd);
    page.classList.remove('is-pending');
    page.classList.add('is-revealed');
    page.querySelector('.bpa-result-stamp')?.classList.add('bpa-slam-a');
    const counter = page.querySelector('[data-score-count]');
    if (!counter) return;
    const target = num(counter.dataset.scoreCount);
    const start = performance.now() + 350;
    const duration = 1250;
    const step = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      counter.textContent = String(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1 && !disposed) rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  };
  const reveal = () => {
    if (revealed || disposed || !motionOk) return;
    if (cutscenes.active || document.visibilityState === 'hidden') return;
    revealed = true;
    lensTarget = app.closest('.bpa-enter') || app.querySelector('.bpa-enter');
    if (lensTarget) {
      lensTarget.addEventListener('animationend', onLensEnd);
      timers.push(window.setTimeout(play, 1300));
    } else {
      play();
    }
  };
  const onVisibility = () => reveal();

  const cutscenes = new CutsceneController(roomId, session.user()?.userId ?? 'guest', () => reveal());
  cutscenes.update(cinematicHost, result.presentation, ['ENDING']);
  const handleKey = (event) => cutscenes.handleKey(event);
  window.addEventListener('keydown', handleKey);
  document.addEventListener('visibilitychange', onVisibility);
  reveal();
  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    timers.forEach((timer) => window.clearTimeout(timer));
    lensTarget?.removeEventListener('animationend', onLensEnd);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('keydown', handleKey);
    cutscenes.dispose();
  };
}
