import '../../../css/33-bpa-profile.css';
import { profileApi } from '../api/profileApi.js';
import { session } from '../services/session.js';
import { tr } from '../services/i18n.js';
import { escapeHtml, render } from '../utils/dom.js';
import { mountCosmeticsPanel } from './detective/cosmeticsPanel.js';
import { ICON_ALERT, accountTab } from './detective/accountTab.js';
import { navigate } from '../services/navigation.js';
import { authorBadge } from '../components/authorBadge.js';

export async function renderDetectivePage(app, userIdParam) {
  const userId = userIdParam || session.user()?.userId;
  if (!userId) {
    navigate('/login');
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

  const sessionUser = session.user();
  const isOwnProfile = !userIdParam || userIdParam === sessionUser?.userId;
  const displayName = profile.displayName || tr('Detective', 'Thám tử');
  const account = isOwnProfile ? accountTab(profile, sessionUser) : null;

  const alertLink = isOwnProfile && !profile.isEmailVerified ? `
    <button type="button" class="bpa-profile-alert" id="bpa-profile-alert">
      ${ICON_ALERT}
      <span class="bpa-profile-alert-txt">
        <span class="bpa-profile-alert-k">${escapeHtml(tr('Email not verified', 'Email chưa xác minh'))}</span>
        <span class="bpa-profile-alert-t">${escapeHtml(tr('Verify to enter games', 'Xác minh để vào game'))}</span>
      </span>
    </button>` : '';

  const intro = isOwnProfile
    ? tr('Your level, frames, titles and lobby entrance, plus your account settings.', 'Cấp độ, viền, danh hiệu và hiệu ứng vào sảnh của bạn, cùng cài đặt tài khoản.')
    : tr('This detective\'s level, frame and title.', 'Cấp độ, viền và danh hiệu của thám tử này.');

  render(app, `
  <div class="bpa-container bpa-profile-page">
    <div class="bpa-profile-top">
      <div class="bpa-label bpa-profile-title">
        <p class="bpa-kicker">${escapeHtml(tr('Detective file', 'Hồ sơ thám tử'))}</p>
        <h1 class="bpa-profile-h1">${escapeHtml(displayName)}</h1>
        ${authorBadge(profile.creatorStats?.authorTier)}
      </div>
      <p class="bpa-profile-intro">${escapeHtml(intro)}</p>
      ${alertLink}
    </div>

    <div id="hs-profile-mount"></div>
  </div>`);

  const panel = mountCosmeticsPanel(app.querySelector('#hs-profile-mount'), {
    userId,
    isOwnProfile,
    displayName,
    extraTabs: account ? [account] : [],
  });

  app.querySelector('#bpa-profile-alert')?.addEventListener('click', () => {
    panel.openTab(account.id);
    app.querySelector('#bpa-profile-account')?.scrollIntoView({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
    (app.querySelector('#btn-resend-verify') || app.querySelector('#bpa-profile-account'))?.focus({ preventScroll: true });
  });

  return panel.dispose;
}
