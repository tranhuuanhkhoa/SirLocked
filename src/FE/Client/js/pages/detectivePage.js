import '../../../css/33-bpa-profile.css';
import { profileApi } from '../api/profileApi.js';
import { authApi } from '../api/authApi.js';
import { session } from '../services/session.js';
import { tr } from '../services/i18n.js';
import { escapeHtml, render, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { Trophy, Gamepad2, Target, Timer, Crown, Folder, Users, createIcons } from 'lucide';
import { renderBadgeSection } from './workshop/badgeSection.js';

// Rank ladder, mirrors DetectiveRanks in the backend (key, English, Vietnamese, minimum cases solved).
const RANK_TIERS = [
  { key: 'APPRENTICE', en: 'Apprentice', vi: 'Tập sự', min: 0 },
  { key: 'DETECTIVE', en: 'Detective', vi: 'Thám tử', min: 3 },
  { key: 'INSPECTOR', en: 'Inspector', vi: 'Thanh tra', min: 10 },
  { key: 'MASTER', en: 'Master', vi: 'Bậc thầy', min: 25 },
];

const ICONS = { Trophy, Gamepad2, Target, Timer, Crown, Folder, Users };

const ICON_ALERT = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5L2.8 19.5h18.4z"></path><path d="M12 9.5v4.5"></path><path d="M12 17v.01"></path></svg>';
const ICON_OK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.8 2.8L16.5 9.5"></path></svg>';
const ICON_MAIL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="1.5"></rect><path d="M3.5 6.5l8.5 6.5 8.5-6.5"></path></svg>';
const ICON_EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const ICON_LOCK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="1.5"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path><path d="M12 14.5v2.5"></path></svg>';
const ICON_ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path></svg>';
const ICON_RULE_NO = '<svg class="bpa-profile-rule-no" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle></svg>';
const ICON_RULE_OK = '<svg class="bpa-profile-rule-ok" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"></path></svg>';
// Hang-tag string + brass pin above each stat tag.
const TWINE_SVG = '<svg class="bpa-profile-twine" viewBox="0 0 30 44" aria-hidden="true" focusable="false"><path d="M15 6C9 16 10 30 13 41M15 6C21 16 20 30 17 41" fill="none" stroke="#cdb98d" stroke-width="1.6" stroke-linecap="round"></path><circle cx="16.2" cy="8" r="6" fill="rgba(0,0,0,.45)"></circle><circle cx="15" cy="6" r="6" fill="#c7a24b"></circle><circle cx="13.4" cy="4.3" r="2.2" fill="#fff1c2" opacity=".75"></circle></svg>';

function pct(fraction) {
  return `${Math.round((fraction ?? 0) * 100)}%`;
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

function tierIndex(key) {
  return RANK_TIERS.findIndex((t) => t.key === key);
}

/** Tier name for display: Vietnamese comes from the API; English is mapped from the stable key. */
function tierName(key, apiLabel) {
  const tier = RANK_TIERS[tierIndex(key)];
  if (!tier) return apiLabel || '';
  return tr(tier.en, apiLabel || tier.vi);
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!name || !domain) return '';
  const masked = name.length <= 2 ? `${name[0]}•••` : `${name[0]}•••${name[name.length - 1]}`;
  return `${masked}@${domain}`;
}

function casesWord(count) {
  return tr(Math.abs(Number(count)) === 1 ? 'case' : 'cases', 'vụ');
}

function statTag(icon, value, label, sub, tilt) {
  return `
    <div class="bpa-profile-tag bpa-profile-tag--${tilt}">
      ${TWINE_SVG}
      <span class="bpa-profile-hole" aria-hidden="true"></span>
      <dt><i data-lucide="${icon}" class="bpa-profile-tag-icon" aria-hidden="true"></i>${escapeHtml(label)}</dt>
      <dd class="bpa-profile-tag-num">${escapeHtml(value)}</dd>
      ${sub ? `<dd class="bpa-profile-tag-sub">${escapeHtml(sub)}</dd>` : ''}
    </div>`;
}

/** Red-string progress: a gold pin at the start of the tier, a red pin at the current position. */
function rankTrack(progress, isMax) {
  const startX = 10;
  const endX = 330;
  const pinX = isMax ? endX : startX + ((endX - 12 - startX) * progress) / 100;
  const sag = 6 + 14 * ((pinX - startX) / (endX - startX));
  const midX = (startX + pinX) / 2;
  const hasString = pinX - startX > 4;
  const stringPath = `M${startX} 13Q${midX.toFixed(1)} ${(13 + sag).toFixed(1)} ${pinX.toFixed(1)} 13`;
  return `
    <svg class="bpa-profile-track" viewBox="0 0 340 36" aria-hidden="true" focusable="false">
      ${isMax ? '' : `<path d="M${(pinX + 8).toFixed(1)} 13H322" fill="none" stroke="rgba(91,82,72,.6)" stroke-width="1.5" stroke-dasharray="3 2"></path>`}
      ${hasString ? `
        <path class="bpa-profile-draw" pathLength="1" d="${stringPath}" transform="translate(2 5)" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="2.8" stroke-linecap="round"></path>
        <path class="bpa-profile-draw" pathLength="1" d="${stringPath}" fill="none" stroke="#bf3b2c" stroke-width="2.1" stroke-linecap="round"></path>` : ''}
      <circle cx="${startX + 1.5}" cy="16.5" r="8" fill="rgba(0,0,0,.3)"></circle>
      <circle cx="${startX}" cy="13" r="8" fill="#c7a24b"></circle>
      <circle cx="${startX - 2.4}" cy="10.4" r="3" fill="#fff1c2" opacity=".8"></circle>
      ${isMax ? '' : `<circle cx="${endX}" cy="13" r="7.5" fill="#fbf6ed" stroke="#5b5248" stroke-width="1.4" stroke-dasharray="2.4 2"></circle>`}
      <g class="bpa-profile-pop">
        <circle cx="${(pinX + 1.5).toFixed(1)}" cy="16.5" r="7.5" fill="rgba(0,0,0,.3)"></circle>
        <circle cx="${pinX.toFixed(1)}" cy="13" r="7.5" fill="#c0392b"></circle>
        <circle cx="${(pinX - 2.3).toFixed(1)}" cy="10.5" r="2.8" fill="#f3a291" opacity=".85"></circle>
      </g>
    </svg>`;
}

function rankLadder(currentIdx) {
  if (currentIdx < 0) return '';
  const steps = RANK_TIERS.map((t, i) => {
    const cls = i < currentIdx ? 'is-past' : (i === currentIdx ? 'is-now' : (i === currentIdx + 1 ? 'is-next' : 'is-future'));
    const sr = i < currentIdx
      ? tr(', passed', ', đã qua')
      : (i === currentIdx ? tr(', current rank', ', bậc hiện tại') : (i === currentIdx + 1 ? tr(', next rank', ', bậc tiếp theo') : ''));
    return `
      <li class="${cls}"${i === currentIdx ? ' aria-current="step"' : ''}>
        <span class="bpa-profile-step bpa-profile-step--${i + 1}" aria-hidden="true"></span>
        <span class="bpa-profile-stepname">${escapeHtml(tr(t.en, t.vi))}</span>
        <span class="bpa-profile-stepnum">${t.min} ${escapeHtml(casesWord(t.min))}</span>
        ${sr ? `<span class="bpa-sr">${escapeHtml(sr)}</span>` : ''}
      </li>`;
  }).join('');
  return `<ol class="bpa-profile-ladder" aria-label="${escapeHtml(tr('Detective ranks by cases solved', 'Các bậc thám tử theo số vụ đã giải'))}">${steps}</ol>`;
}

export async function renderDetectivePage(app, userIdParam) {
  const userId = userIdParam || session.user()?.userId;
  if (!userId) {
    window.location.hash = '#/login';
    return;
  }

  render(app, `
    <div class="bpa-container bpa-profile-page">
      <p class="bpa-profile-loading" role="status">
        <span class="bpa-profile-spinner bpa-spin" aria-hidden="true"></span>
        ${escapeHtml(tr('Loading detective profile…', 'Đang tải hồ sơ thám tử…'))}
      </p>
    </div>`);

  let profile;
  try {
    profile = userIdParam ? await profileApi.get(userId) : await profileApi.me();
  } catch (err) {
    render(app, `
      <div class="bpa-container bpa-profile-page">
        <div class="bpa-paper bpa-paper--note bpa-profile-error" role="alert">
          <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
          <p class="bpa-kicker">${escapeHtml(tr('Profile unavailable', 'Không mở được hồ sơ'))}</p>
          <p class="bpa-profile-error-text">${escapeHtml(err.message)}</p>
        </div>
      </div>`);
    return;
  }

  const rank = profile.rank || {};
  const sessionUser = session.user();
  const isOwnProfile = !userIdParam || userIdParam === sessionUser?.userId;
  const displayName = profile.displayName || tr('Detective', 'Thám tử');

  // ---- rank -------------------------------------------------------------------------------
  const currentIdx = tierIndex(rank.tier);
  const isMax = rank.nextThreshold == null;
  const progress = Math.max(0, Math.min(100, Math.round(rank.progressPercent || 0)));
  const solved = rank.solved ?? profile.casesSolved ?? 0;
  const tierLabel = tierName(rank.tier, rank.tierLabel);
  const nextKey = currentIdx >= 0 ? RANK_TIERS[currentIdx + 1]?.key : null;
  const nextLabel = nextKey ? tierName(nextKey, rank.nextTierLabel) : (rank.nextTierLabel || '');
  const remaining = !isMax ? Math.max(0, rank.nextThreshold - solved) : 0;
  const progressText = !isMax
    ? tr(
      `${remaining} more ${remaining === 1 ? 'case' : 'cases'} to <strong>${escapeHtml(nextLabel)}</strong>`,
      `Còn ${remaining} vụ tới <strong>${escapeHtml(nextLabel)}</strong>`,
    )
    : tr('Highest rank reached', 'Đã đạt cấp bậc cao nhất');
  const progressMini = !isMax
    ? `${solved} / ${rank.nextThreshold} ${casesWord(rank.nextThreshold)}`
    : `${solved} ${casesWord(solved)}`;
  const progressValueText = !isMax
    ? tr(
      `${solved} of ${rank.nextThreshold} cases solved, ${progress}% of the way to ${nextLabel}`,
      `Đã giải ${solved} trên ${rank.nextThreshold} vụ, đi được ${progress}% chặng tới ${nextLabel}`,
    )
    : tr(`${solved} cases solved, highest rank reached`, `Đã giải ${solved} vụ, đã đạt cấp bậc cao nhất`);
  const currentMin = currentIdx >= 0 ? RANK_TIERS[currentIdx].min : null;
  const trackStart = `${tierLabel}${currentMin != null ? ` · ${currentMin}` : ''}`;
  const trackEnd = !isMax ? `${nextLabel} · ${rank.nextThreshold}` : tr('Top of the ladder', 'Đỉnh bậc thang');

  const roleChip = (profile.role === 'VIP' || profile.role === 'ADMIN')
    ? `<span class="bpa-chip bpa-chip--rust bpa-profile-role"><i data-lucide="crown" aria-hidden="true"></i>${escapeHtml(profile.role)}</span>`
    : '';

  const ringText = tr('SIR LOCKED · DETECTIVE BUREAU · CASE FILES ·', 'SIR LOCKED · SỞ ĐIỀU TRA · HỒ SƠ MẬT ·');

  const idCard = `
    <section class="bpa-paper bpa-paper--card bpa-profile-id bpa-profile-o1" aria-labelledby="bpa-profile-id-h">
      <span class="bpa-pin" aria-hidden="true"></span>
      <div class="bpa-profile-idhead">
        <h2 id="bpa-profile-id-h" class="bpa-kicker bpa-profile-kick">${escapeHtml(tr('Detective card', 'Thẻ thám tử'))}</h2>
        <span class="bpa-kicker bpa-profile-kick">${escapeHtml(isOwnProfile ? tr('Your file', 'Hồ sơ của bạn') : tr('Colleague', 'Đồng nghiệp'))}</span>
      </div>
      <div class="bpa-profile-who">
        <div class="bpa-profile-seal" aria-hidden="true">
          <svg viewBox="0 0 132 132" focusable="false">
            <defs><path id="bpa-profile-ring" d="M66 66m-53 0a53 53 0 1 1 106 0a53 53 0 1 1-106 0"></path></defs>
            <g opacity=".78">
              <circle cx="66" cy="66" r="64" fill="none" stroke="#1a2c42" stroke-width="1.6"></circle>
              <circle cx="66" cy="66" r="61" fill="none" stroke="#1a2c42" stroke-width=".8"></circle>
              <text class="bpa-profile-ringtext"><textPath href="#bpa-profile-ring" textLength="326" lengthAdjust="spacing">${escapeHtml(ringText)}</textPath></text>
            </g>
          </svg>
          <span class="bpa-avatar bpa-profile-mono">${escapeHtml(initials(displayName))}</span>
        </div>
        <div class="bpa-profile-whotxt">
          <p class="bpa-profile-name">${escapeHtml(displayName)}</p>
          <div class="bpa-profile-chips">
            ${tierLabel ? `<span class="bpa-chip bpa-chip--dark">${escapeHtml(tierLabel)}</span>` : ''}
            ${roleChip}
          </div>
        </div>
      </div>
      <div class="bpa-profile-rank">
        <div class="bpa-profile-rankrow">
          <p class="bpa-profile-ranktxt">${progressText}</p>
          <span class="bpa-profile-mini">${escapeHtml(progressMini)}</span>
        </div>
        <div class="bpa-profile-progress" role="progressbar"
             aria-label="${escapeHtml(tr('Rank progress', 'Tiến độ thăng bậc'))}"
             aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"
             aria-valuetext="${escapeHtml(progressValueText)}">
          ${rankTrack(progress, isMax)}
        </div>
        <div class="bpa-profile-trackends" aria-hidden="true">
          <span class="bpa-profile-mini">${escapeHtml(trackStart)}</span>
          <span class="bpa-profile-mini">${escapeHtml(trackEnd)}</span>
        </div>
      </div>
      ${rankLadder(currentIdx)}
    </section>`;

  // ---- stats ------------------------------------------------------------------------------
  const unsolved = Math.max(0, (profile.casesPlayed || 0) - (profile.casesSolved || 0));
  const tags = [
    statTag('trophy', String(profile.casesSolved), tr('Cases solved', 'Vụ đã giải'),
      tr(`of ${profile.casesPlayed} ${profile.casesPlayed === 1 ? 'case' : 'cases'} played`, `trên ${profile.casesPlayed} vụ đã chơi`), 'a'),
    statTag('gamepad-2', String(profile.casesPlayed), tr('Cases played', 'Vụ đã chơi'),
      tr(`${unsolved} not cracked yet`, `${unsolved} vụ chưa phá được`), 'b'),
    statTag('target', pct(profile.successRate), tr('Win rate', 'Tỉ lệ thắng'),
      tr('Across all plays', 'Tính theo mọi lượt chơi'), 'c'),
  ];
  if (profile.fastestSolveSeconds != null) {
    tags.push(statTag('timer', formatDuration(profile.fastestSolveSeconds), tr('Fastest solve', 'Phá nhanh nhất'),
      tr('Quickest winning game', 'Ván thắng nhanh nhất'), 'd'));
  }

  const statsBlock = profile.casesPlayed === 0
    ? `
      <section class="bpa-profile-stats bpa-profile-o2" aria-labelledby="bpa-profile-stats-h">
        <h2 id="bpa-profile-stats-h" class="bpa-sr">${escapeHtml(tr('Case record', 'Thống kê phá án'))}</h2>
        <div class="bpa-paper bpa-paper--note bpa-profile-empty">
          <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
          <p class="bpa-kicker">${escapeHtml(tr('Case record · empty', 'Sổ phá án · trống'))}</p>
          <p class="bpa-profile-empty-text">${isOwnProfile
    ? escapeHtml(tr('New detective — no cases yet. Head to the Workshop and pick a case to get started!', 'Thám tử mới — chưa có vụ nào. Vào Workshop chọn một vụ để bắt đầu!'))
    : escapeHtml(tr('New detective — no cases played yet.', 'Thám tử mới — chưa chơi vụ nào.'))}</p>
          ${isOwnProfile ? `<a class="bpa-profile-go" href="#/workshop">${escapeHtml(tr('Open the Workshop', 'Vào Workshop'))} ${ICON_ARROW}</a>` : ''}
        </div>
      </section>`
    : `
      <section class="bpa-profile-stats bpa-profile-o2" aria-labelledby="bpa-profile-stats-h">
        <h2 id="bpa-profile-stats-h" class="bpa-sr">${escapeHtml(tr('Case record', 'Thống kê phá án'))}</h2>
        <dl class="bpa-profile-tags bpa-profile-tags--${tags.length}">${tags.join('')}</dl>
      </section>`;

  // ---- badges -----------------------------------------------------------------------------
  const badgeBlock = `
    <section class="bpa-panel bpa-profile-cabinet bpa-profile-o3" aria-labelledby="bpa-profile-badges-h">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <div class="bpa-profile-cabinet-head">
        <p class="bpa-kicker bpa-profile-kick bpa-profile-kick--gold">${escapeHtml(tr('Medal cabinet', 'Tủ huy chương'))}</p>
        <h2 id="bpa-profile-badges-h" class="bpa-profile-h2 bpa-profile-h2--light">${escapeHtml(tr('Badges', 'Huy hiệu'))}</h2>
      </div>
      <div id="ws-badge-mount"></div>
    </section>`;

  // ---- creator stats (null while cases have no author field -> section hidden) --------------
  const creator = profile.creatorStats;
  const creatorBlock = creator ? `
    <section class="bpa-paper bpa-paper--folder bpa-profile-mine bpa-profile-o5" aria-labelledby="bpa-profile-mine-h">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <p class="bpa-kicker bpa-profile-kick bpa-profile-kick--kraft">${escapeHtml(tr('Workshop · Author', 'Workshop · Tác giả'))}</p>
      <h2 id="bpa-profile-mine-h" class="bpa-profile-h2">${escapeHtml(isOwnProfile ? tr('My cases', 'Case tôi tạo') : tr('Cases created', 'Case đã tạo'))}</h2>
      <dl class="bpa-profile-minetiles">
        <div><dt><i data-lucide="folder" aria-hidden="true"></i>${escapeHtml(tr('Cases created', 'Case đã tạo'))}</dt><dd>${escapeHtml(String(creator.casesCreated))}</dd></div>
        <div><dt><i data-lucide="users" aria-hidden="true"></i>${escapeHtml(tr('Total plays', 'Tổng lượt chơi'))}</dt><dd>${escapeHtml(String(creator.totalPlays))}</dd></div>
      </dl>
      ${isOwnProfile ? `
        <p class="bpa-profile-mine-note">${escapeHtml(tr('Cases you wrote for the community — edit, publish and see their stats in the Workshop.', 'Vụ án bạn viết cho cộng đồng — sửa, xuất bản và xem thống kê trong Workshop.'))}</p>
        <div class="bpa-profile-mine-foot">
          <a class="bpa-profile-go" href="#/workshop">${escapeHtml(tr('Open the Workshop', 'Vào Workshop'))} ${ICON_ARROW}</a>
        </div>` : '<div class="bpa-profile-mine-foot"></div>'}
    </section>` : '';

  // ---- account (own profile only) -----------------------------------------------------------
  const email = isOwnProfile ? maskEmail(sessionUser?.email) : '';
  const verified = !!profile.isEmailVerified;
  const accountBlock = isOwnProfile ? `
    <section id="bpa-profile-account" class="bpa-paper bpa-paper--card bpa-profile-acct bpa-profile-o6" aria-labelledby="bpa-profile-acct-h" tabindex="-1">
      <span class="bpa-pin" aria-hidden="true"></span>
      <div class="bpa-profile-stampbox" aria-hidden="true">
        <span class="bpa-stamp ${verified ? 'bpa-stamp--teal' : ''} bpa-profile-stamp">${escapeHtml(verified ? tr('Verified', 'Đã xác minh') : tr('Not verified', 'Chưa xác minh'))}</span>
      </div>
      <p class="bpa-kicker bpa-profile-kick">${escapeHtml(tr('Form · Confidential', 'Mẫu khai · Bảo mật'))}</p>
      <h2 id="bpa-profile-acct-h" class="bpa-profile-h2">${escapeHtml(tr('Account', 'Tài khoản'))}</h2>

      <div class="bpa-profile-acct-body${profile.hasPassword ? ' has-password' : ''}">
      <div class="bpa-profile-acct-email">
      ${email ? `
        <div class="bpa-profile-emailrow">
          <span class="bpa-profile-label">${escapeHtml(tr('Email', 'Email'))}</span>
          <span class="bpa-profile-emailval">${escapeHtml(email)}</span>
        </div>` : ''}

      ${verified ? `
        <p class="bpa-profile-okline">${ICON_OK}${escapeHtml(tr('Email verified', 'Email đã được xác minh'))}</p>` : `
        <div class="bpa-profile-verify">
          <div class="bpa-profile-note bpa-profile-note--warn">
            ${ICON_ALERT}
            <div><strong>${escapeHtml(tr('Email not verified', 'Email chưa xác minh'))}</strong>${escapeHtml(tr('You need to verify your email to enter a game. Check your inbox and open the link in the email.', 'Bạn cần xác minh email để vào game. Hãy kiểm tra hộp thư và nhấn liên kết trong email.'))}</div>
          </div>
          <button type="button" class="bpa-btn bpa-btn--ink bpa-profile-resend" id="btn-resend-verify">
            ${ICON_MAIL}${escapeHtml(tr('Resend verification email', 'Gửi lại email xác minh'))}
          </button>
          <div id="verify-token-result" role="status"></div>
        </div>`}
      </div>

      ${profile.hasPassword ? `
        <form id="form-change-password" class="bpa-profile-pwform" aria-labelledby="bpa-profile-pw-h">
          <div class="bpa-profile-pwhead">
            <h3 id="bpa-profile-pw-h" class="bpa-profile-h3">${escapeHtml(tr('Change password', 'Đổi mật khẩu'))}</h3>
            <button type="button" class="bpa-profile-eye" id="bpa-profile-pw-toggle" aria-pressed="false">
              ${ICON_EYE}${escapeHtml(tr('Show', 'Hiện'))}<span class="bpa-sr"> ${escapeHtml(tr('passwords', 'mật khẩu'))}</span>
            </button>
          </div>
          <div class="bpa-profile-fieldwrap">
            <label class="bpa-field-label bpa-profile-label" for="bpa-profile-pw-cur">${escapeHtml(tr('Current password', 'Mật khẩu hiện tại'))}</label>
            <input class="bpa-field bpa-profile-input" id="bpa-profile-pw-cur" name="currentPassword" type="password" required autocomplete="current-password">
          </div>
          <div class="bpa-profile-fieldwrap">
            <label class="bpa-field-label bpa-profile-label" for="bpa-profile-pw-new">${escapeHtml(tr('New password', 'Mật khẩu mới'))}
              <span class="bpa-profile-hint">${escapeHtml(tr('(at least 6 characters, letters and numbers)', '(tối thiểu 6 ký tự, gồm chữ và số)'))}</span>
            </label>
            <input class="bpa-field bpa-profile-input" id="bpa-profile-pw-new" name="newPassword" type="password" required minlength="6" autocomplete="new-password" aria-describedby="bpa-profile-pw-rules">
            <ul id="bpa-profile-pw-rules" class="bpa-profile-rules">
              <li class="bpa-profile-rule" data-rule="len">${ICON_RULE_NO}${ICON_RULE_OK}${escapeHtml(tr('At least 6 characters', 'Ít nhất 6 ký tự'))}</li>
              <li class="bpa-profile-rule" data-rule="mix">${ICON_RULE_NO}${ICON_RULE_OK}${escapeHtml(tr('Letters and numbers', 'Có cả chữ và số'))}</li>
            </ul>
          </div>
          <div class="bpa-profile-fieldwrap">
            <label class="bpa-field-label bpa-profile-label" for="bpa-profile-pw-conf">${escapeHtml(tr('Confirm new password', 'Xác nhận mật khẩu mới'))}</label>
            <input class="bpa-field bpa-profile-input" id="bpa-profile-pw-conf" name="confirmPassword" type="password" required minlength="6" autocomplete="new-password">
          </div>
          <button class="bpa-btn bpa-btn--red bpa-btn--block bpa-profile-save" type="submit">
            ${ICON_LOCK}${escapeHtml(tr('Save password', 'Lưu mật khẩu'))}
          </button>
        </form>` : ''}
      </div>
    </section>` : '';

  const alertLink = isOwnProfile && !verified ? `
    <button type="button" class="bpa-profile-alert" id="bpa-profile-alert">
      ${ICON_ALERT}
      <span class="bpa-profile-alert-txt">
        <span class="bpa-profile-alert-k">${escapeHtml(tr('Email not verified', 'Email chưa xác minh'))}</span>
        <span class="bpa-profile-alert-t">${escapeHtml(tr('Verify to enter games', 'Xác minh để vào game'))}</span>
      </span>
    </button>` : '';

  const intro = isOwnProfile
    ? tr('Your record, rank and badges — plus your account settings.', 'Thành tích, cấp bậc và huy hiệu của bạn — cùng cài đặt tài khoản.')
    : tr('This detective\'s record, rank and badges.', 'Thành tích, cấp bậc và huy hiệu của thám tử này.');

  render(app, `
  <div class="bpa-container bpa-profile-page">
    <div class="bpa-profile-top">
      <div class="bpa-label bpa-profile-title">
        <p class="bpa-kicker">${escapeHtml(tr('Detective file', 'Hồ sơ thám tử'))}</p>
        <h1 class="bpa-profile-h1">${escapeHtml(displayName)}</h1>
      </div>
      <p class="bpa-profile-intro">${escapeHtml(intro)}</p>
      ${alertLink}
    </div>

    <div class="bpa-profile-grid${isOwnProfile ? '' : ' is-visitor'}">
      <div class="bpa-profile-col bpa-profile-col--side">
        ${idCard}
        ${creatorBlock}
      </div>
      <div class="bpa-profile-col bpa-profile-col--main">
        ${statsBlock}
        ${badgeBlock}
        ${accountBlock}
      </div>
    </div>
  </div>`);

  createIcons({ icons: ICONS, root: app });

  renderBadgeSection(userId, app.querySelector('#ws-badge-mount'));

  const alertBtn = app.querySelector('#bpa-profile-alert');
  if (alertBtn) {
    alertBtn.addEventListener('click', () => {
      const account = app.querySelector('#bpa-profile-account');
      if (!account) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      account.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      (app.querySelector('#btn-resend-verify') || account).focus({ preventScroll: true });
    });
  }

  const btnResendVerify = app.querySelector('#btn-resend-verify');
  if (btnResendVerify) {
    btnResendVerify.addEventListener('click', async () => {
      btnResendVerify.disabled = true;
      try {
        await authApi.resendVerification();
        const resultDiv = app.querySelector('#verify-token-result');
        resultDiv.innerHTML = `
          <p class="bpa-profile-note bpa-profile-note--ok bpa-profile-reveal">
            ${ICON_OK}
            <span>${escapeHtml(tr('A new verification email is on its way. Check your inbox (and the Spam folder), then open the link in the email.', 'Đã gửi lại email xác minh. Kiểm tra hộp thư (cả mục Spam) rồi nhấn liên kết trong email.'))}</span>
          </p>`;
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btnResendVerify.disabled = false;
      }
    });
  }

  const changePasswordForm = app.querySelector('#form-change-password');
  if (changePasswordForm) {
    const pwInputs = [...changePasswordForm.querySelectorAll('input')];
    const newInput = changePasswordForm.querySelector('[name=newPassword]');
    const confirmInput = changePasswordForm.querySelector('[name=confirmPassword]');
    const toggle = changePasswordForm.querySelector('#bpa-profile-pw-toggle');

    toggle.addEventListener('click', () => {
      const show = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(show));
      pwInputs.forEach((input) => { input.type = show ? 'text' : 'password'; });
    });

    // Live hints only; the rules themselves are enforced by the server.
    const updateRules = () => {
      const value = String(newInput.value || '');
      const checks = {
        len: value.length >= 6,
        mix: /[A-Za-zÀ-ỹ]/.test(value) && /\d/.test(value),
      };
      changePasswordForm.querySelectorAll('[data-rule]').forEach((li) => {
        li.classList.toggle('is-ok', !!checks[li.dataset.rule]);
      });
    };
    newInput.addEventListener('input', updateRules);
    confirmInput.addEventListener('input', () => confirmInput.removeAttribute('aria-invalid'));

    changePasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const currentPassword = data.get('currentPassword');
      const newPassword = data.get('newPassword');
      const confirmPassword = data.get('confirmPassword');

      if (newPassword !== confirmPassword) {
        confirmInput.setAttribute('aria-invalid', 'true');
        toast(tr('The confirmation password does not match.', 'Mật khẩu xác nhận không khớp.'), 'error');
        return;
      }

      const btn = changePasswordForm.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await authApi.changePassword(currentPassword, newPassword);
        toast(tr('Password changed!', 'Đổi mật khẩu thành công!'), 'success');
        changePasswordForm.reset();
        updateRules();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }
}
