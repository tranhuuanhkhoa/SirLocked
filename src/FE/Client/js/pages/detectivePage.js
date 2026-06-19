import { profileApi } from '../api/profileApi.js';
import { session } from '../services/session.js';
import { escapeHtml, render } from '../utils/dom.js';
import { Award, Trophy, Gamepad2, Target, Timer, Crown, Folder, Users, createIcons } from 'lucide';
import { renderBadgeSection } from './workshop/badgeSection.js';

function pct(fraction) {
  return `${Math.round((fraction ?? 0) * 100)}%`;
}

function formatDuration(seconds) {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}′${String(rem).padStart(2, '0')}″` : `${rem}″`;
}

function statTile(icon, value, label) {
  return `
    <div class="ws-profile-stat">
      <i data-lucide="${icon}" class="ws-profile-stat-icon" aria-hidden="true"></i>
      <div class="ws-profile-stat-value">${escapeHtml(value)}</div>
      <div class="ws-profile-stat-label">${escapeHtml(label)}</div>
    </div>`;
}

export async function renderDetectivePage(app, userIdParam) {
  const userId = userIdParam || session.user()?.userId;
  if (!userId) {
    window.location.hash = '#/login';
    return;
  }

  render(app, '<div class="page"><p class="muted">Đang tải hồ sơ thám tử…</p></div>');

  let profile;
  try {
    profile = userIdParam ? await profileApi.get(userId) : await profileApi.me();
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  const rank = profile.rank || {};
  const roleBadge = (profile.role === 'VIP' || profile.role === 'ADMIN')
    ? `<span class="chip chip-gold ws-profile-role"><i data-lucide="crown" aria-hidden="true"></i> ${escapeHtml(profile.role)}</span>`
    : '';

  const remaining = rank.nextThreshold != null ? Math.max(0, rank.nextThreshold - rank.solved) : 0;
  const progressText = rank.nextThreshold != null
    ? `Còn ${remaining} vụ tới <strong>${escapeHtml(rank.nextTierLabel || '')}</strong>`
    : 'Đã đạt cấp bậc cao nhất';
  const progress = Math.round(rank.progressPercent || 0);

  const tiles = [
    statTile('trophy', String(profile.casesSolved), 'Vụ đã giải'),
    statTile('gamepad-2', String(profile.casesPlayed), 'Vụ đã chơi'),
    statTile('target', pct(profile.successRate), 'Tỉ lệ thắng'),
  ];
  if (profile.fastestSolveSeconds != null) {
    tiles.push(statTile('timer', formatDuration(profile.fastestSolveSeconds), 'Phá nhanh nhất'));
  }

  const creator = profile.creatorStats; // null while GameCase has no author field -> section hidden

  const statsBlock = profile.casesPlayed === 0
    ? '<div class="empty-state">Thám tử mới — chưa có vụ nào. Vào Workshop chọn một vụ để bắt đầu!</div>'
    : `<div class="ws-profile-stat-grid">${tiles.join('')}</div>`;

  render(app, `
  <div class="page">
    <div class="ws-profile-header">
      <div class="ws-profile-badge" title="${escapeHtml(rank.tierLabel || '')}">
        <i data-lucide="award" aria-hidden="true"></i>
      </div>
      <div class="ws-profile-id">
        <h2>${escapeHtml(profile.displayName || 'Thám tử')} ${roleBadge}</h2>
        <div class="ws-profile-rank-line">
          <span class="chip chip-gold">${escapeHtml(rank.tierLabel || '')}</span>
          <span class="muted small">${progressText}</span>
        </div>
        <div class="ws-profile-progress" role="progressbar"
             aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
          <span class="ws-profile-progress-fill" style="width: ${progress}%"></span>
        </div>
      </div>
    </div>

    ${statsBlock}

    <h3 class="section-title">Huy hiệu</h3>
    <div id="ws-badge-mount"></div>

    ${creator ? `
      <h3 class="section-title">Case tôi tạo</h3>
      <div class="ws-profile-stat-grid">
        ${statTile('folder', String(creator.casesCreated), 'Case đã tạo')}
        ${statTile('users', String(creator.totalPlays), 'Tổng lượt chơi')}
      </div>` : ''}
  </div>`);

  createIcons({ icons: { Award, Trophy, Gamepad2, Target, Timer, Crown, Folder, Users } });

  renderBadgeSection(userId, app.querySelector('#ws-badge-mount'));
}
