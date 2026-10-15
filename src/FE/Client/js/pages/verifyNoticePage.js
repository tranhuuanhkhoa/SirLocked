import { session } from '../services/session.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { tr } from '../services/i18n.js';
import { pendingRoomInvite } from '../services/roomInvites.js';
import { RESEND_ICON, envelopeHero, verifyBoardMarkup, wireResend } from './verifyEmailPage.js';

export async function renderVerifyNoticePage(app) {
  const user = session.user();
  const email = user?.email
    ? `<span class="bpa-auth-email">${escapeHtml(user.email)}</span>`
    : tr('your email', 'email của bạn');

  render(app, verifyBoardMarkup(`
    ${envelopeHero('check')}
    <h2 id="verify-title" class="bpa-auth-title">${tr('Check your email', 'Kiểm tra email của bạn')}</h2>
    <p class="bpa-auth-text">${tr(`We sent a verification link to ${email}.`, `Chúng tôi đã gửi một liên kết xác minh tới ${email}.`)}</p>
    <p class="bpa-auth-text">${tr(
      'Open the email and press <span class="bpa-auth-q">“Verify account”</span> to activate it and enter the game.',
      'Hãy mở email và nhấn <span class="bpa-auth-q">“Xác minh tài khoản”</span> để kích hoạt và vào game.',
    )}</p>
    <p class="bpa-auth-note bpa-auth-note--memo">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5e4a1c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13.5l2.6-7.2A1.5 1.5 0 0 1 7 5.3h10a1.5 1.5 0 0 1 1.4 1l2.6 7.2"/><path d="M3 13.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18v-4.5h-5l-1.5 2.5h-5L8 13.5z"/></svg>
      <span><b>${tr('No email?', 'Không thấy email?')}</b><br>${tr('Check your Spam / Promotions folders too.', 'Kiểm tra cả mục Spam / Quảng cáo.')}</span>
    </p>
    ${pendingRoomInvite() ? `
      <div class="bpa-auth-note bpa-auth-note--invite" id="saved-room-invite">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2f6363" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20.5V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5v16"/><path d="M3 20.5h18"/><path d="M15 12.5h.01"/></svg>
        <p>${tr(
          '<b>Your room invitation has been saved.</b> After verifying your email you can continue to the room you were invited to.',
          '<b>Lời mời vào phòng đã được lưu.</b> Sau khi xác minh email, bạn có thể tiếp tục tới phòng được mời.',
        )}</p>
      </div>` : ''}
    <button type="button" class="bpa-auth-ink" id="btn-resend">${RESEND_ICON}<span>${tr('Resend verification email', 'Gửi lại email xác minh')}</span></button>
    <div id="resend-result" role="status"></div>
    <p class="bpa-auth-center">
      <a href="#/login" id="link-logout" class="bpa-auth-link">${tr('Sign in with another account', 'Đăng nhập bằng tài khoản khác')}</a>
    </p>`));

  wireResend(app, qs('#btn-resend', app), qs('#resend-result', app));

  qs('#link-logout', app).addEventListener('click', (e) => {
    e.preventDefault();
    session.clear();
    window.location.hash = '#/login';
  });
}
