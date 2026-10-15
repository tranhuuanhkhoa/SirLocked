import { session } from '../services/session.js';
import { authApi } from '../api/authApi.js';
import { render } from '../utils/dom.js';
import { tr } from '../services/i18n.js';
import { toast } from '../utils/toast.js';
import { pendingRoomInvite } from '../services/roomInvites.js';
import { authHead, loginBoardMarkup } from './loginPage.js';

export async function renderOAuthCallbackPage(app) {
  render(app, loginBoardMarkup(`
    <section class="bpa-auth-section bpa-auth-rise-late" aria-labelledby="oauth-title">
      <div class="bpa-auth-card">
        <span class="bpa-auth-pin is-solving" aria-hidden="true"></span>
        ${authHead(tr('Case card', 'Thẻ điều tra'), 'GOOGLE')}
        <h2 id="oauth-title" class="bpa-auth-title">${tr('Processing Google sign-in…', 'Đang xử lý đăng nhập Google...')}</h2>
        <p class="bpa-auth-sub">${tr('Following the trail back to your account.', 'Đang lần theo dấu về tài khoản của bạn.')}</p>
        <svg viewBox="0 0 300 20" width="100%" height="20" aria-hidden="true" focusable="false" style="display:block;margin-top:18px;overflow:visible">
          <path class="bpa-auth-runline" d="M10 10H290" stroke="#c7a24b" stroke-width="2.4" stroke-linecap="round"/>
          <circle cx="10" cy="10" r="6" fill="url(#bpa-auth-pin-red)"/>
          <circle cx="290" cy="10" r="6" fill="url(#bpa-auth-pin-gold)"/>
        </svg>
        <p class="bpa-sr" role="status">${tr('Processing Google sign-in…', 'Đang xử lý đăng nhập Google...')}</p>
      </div>
    </section>`, { threadsClass: 'is-solving' }));

  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const token = params.get('token');
  const refreshToken = params.get('refreshToken');
  const error = params.get('error');

  if (error || !token) {
    toast(tr('Google sign-in failed. Please try again.', 'Đăng nhập Google thất bại. Vui lòng thử lại.'), 'error');
    window.location.hash = '#/login';
    return;
  }

  try {
    // Lưu token tạm để gọi /me
    localStorage.setItem('sirlocked.token', token);
    if (refreshToken) localStorage.setItem('sirlocked.refreshToken', refreshToken);

    const user = await authApi.me();
    if (!app.isConnected) return;
    session.save({ token, refreshToken, refreshTokenExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), user });

    toast(tr(`Welcome, ${user.fullName}!`, `Chào mừng, ${user.fullName}!`), 'success');
    window.location.hash = pendingRoomInvite() || (user.role === 'ADMIN' ? '#/admin' : '#/menu');
  } catch {
    if (!app.isConnected) return;
    session.clear();
    toast(tr('Google sign-in failed.', 'Đăng nhập Google thất bại.'), 'error');
    window.location.hash = '#/login';
  }
}
