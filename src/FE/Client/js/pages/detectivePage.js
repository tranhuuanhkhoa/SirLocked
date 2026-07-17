import { profileApi } from '../api/profileApi.js';
import { authApi } from '../api/authApi.js';
import { session } from '../services/session.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
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
  const isOwnProfile = !userIdParam || userIdParam === session.user()?.userId;

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

    ${isOwnProfile && !profile.isEmailVerified ? `
      <div style="background:#2a1a00;border:1px solid #7a4a00;border-radius:8px;padding:14px;margin-bottom:20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="color:#f0a030;font-size:20px">⚠️</span>
        <div style="flex:1;min-width:200px">
          <strong style="color:#f0c060">Email chưa xác minh</strong>
          <p style="color:#8899aa;font-size:12px;margin:2px 0 0">Bạn cần xác minh email để vào game. Hãy kiểm tra hộp thư và nhấn liên kết trong email.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-resend-verify">Gửi lại email xác minh</button>
      </div>
      <div id="verify-token-result" style="margin-bottom:24px"></div>` : ''}

    ${isOwnProfile && profile.isEmailVerified ? `
      <div style="background:#0f2a0f;border:1px solid #2a6a2a;border-radius:8px;padding:12px;margin-bottom:20px;display:flex;align-items:center;gap:10px">
        <span style="color:#7ecf7e">✅</span>
        <span style="color:#7ecf7e;font-size:13px">Email đã được xác minh</span>
      </div>` : ''}

    ${isOwnProfile && profile.hasPassword ? `
      <h3 class="section-title">Đổi mật khẩu</h3>
      <form id="form-change-password" class="auth-form" style="max-width:420px">
        <label class="field-label">Mật khẩu hiện tại
          <input class="field-input" name="currentPassword" type="password" required placeholder="••••••••">
        </label>
        <label class="field-label">Mật khẩu mới (tối thiểu 6 ký tự, gồm chữ và số)
          <input class="field-input" name="newPassword" type="password" required minlength="6" placeholder="••••••••">
        </label>
        <label class="field-label">Xác nhận mật khẩu mới
          <input class="field-input" name="confirmPassword" type="password" required minlength="6" placeholder="••••••••">
        </label>
        <button class="btn btn-primary" type="submit">Lưu mật khẩu</button>
      </form>` : ''}
  </div>`);

  createIcons({ icons: { Award, Trophy, Gamepad2, Target, Timer, Crown, Folder, Users } });

  renderBadgeSection(userId, app.querySelector('#ws-badge-mount'));

  const btnResendVerify = app.querySelector('#btn-resend-verify');
  if (btnResendVerify) {
    btnResendVerify.addEventListener('click', async () => {
      btnResendVerify.disabled = true;
      try {
        await authApi.resendVerification();
        const resultDiv = app.querySelector('#verify-token-result');
        resultDiv.innerHTML = `
          <div style="background:#1a2a1a;border:1px solid #4a7a4a;border-radius:6px;padding:10px;font-size:12px;margin-bottom:12px">
            <p style="color:#7ecf7e;margin:0">✅ Đã gửi mã xác minh tới email của bạn. Kiểm tra hộp thư (cả mục Spam) rồi dán mã vào ô bên dưới.</p>
          </div>`;
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btnResendVerify.disabled = false;
      }
    });
  }

  const changePasswordForm = app.querySelector('#form-change-password');
  if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const currentPassword = data.get('currentPassword');
      const newPassword = data.get('newPassword');
      const confirmPassword = data.get('confirmPassword');

      if (newPassword !== confirmPassword) {
        toast('Mật khẩu xác nhận không khớp.', 'error');
        return;
      }

      const btn = changePasswordForm.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await authApi.changePassword(currentPassword, newPassword);
        toast('Đổi mật khẩu thành công!', 'success');
        changePasswordForm.reset();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }
}
