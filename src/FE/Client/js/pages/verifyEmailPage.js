import { authApi } from '../api/authApi.js';
import { session } from '../services/session.js';
import { render, qs } from '../utils/dom.js';

export async function renderVerifyEmailPage(app) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const token = params.get('token');

  render(app, `
  <div class="auth-screen">
    <div class="auth-panel">
      <div class="auth-logo">
        <h1>SIR LOCKED</h1>
        <p>The Mystery Awaits</p>
      </div>
      <div class="gold-divider"></div>
      <style>
        @keyframes sl-spin { to { transform: rotate(360deg); } }
        .sl-spinner {
          width: 38px; height: 38px; margin: 18px auto; border-radius: 50%;
          border: 3px solid rgba(216,174,82,0.25); border-top-color: #d8ae52;
          animation: sl-spin 0.8s linear infinite;
        }
      </style>
      <div id="verify-state" style="text-align:center;padding:8px 0">
        <div class="sl-spinner"></div>
        <p style="color:#efe7d2">Đang xác minh tài khoản của bạn...</p>
      </div>
    </div>
  </div>`);

  const stateEl = qs('#verify-state', app);

  if (!token) {
    stateEl.innerHTML = `
      <div style="font-size:42px;margin-bottom:8px">⚠️</div>
      <h2 style="color:#f0c060;margin:0 0 8px">Liên kết không hợp lệ</h2>
      <p style="color:#8899aa;font-size:14px">Không tìm thấy mã xác minh trong liên kết.</p>
      <a href="#/login" class="btn btn-primary btn-block" style="margin-top:18px">Về trang đăng nhập</a>`;
    return;
  }

  try {
    await authApi.verifyEmail(token);
    // Nếu đang đăng nhập thì mở khóa game ngay
    if (session.isLoggedIn()) session.setEmailVerified();

    const goHref = session.isLoggedIn() ? '#/menu' : '#/login';
    const goText = session.isLoggedIn() ? 'Vào game ngay' : 'Đăng nhập';
    stateEl.innerHTML = `
      <div style="font-size:48px;margin-bottom:8px">✅</div>
      <h2 style="color:#7ecf7e;margin:0 0 8px">Xác minh thành công!</h2>
      <p style="color:#cfc7b2;font-size:14px">Tài khoản của bạn đã được kích hoạt. Bây giờ bạn có thể vào game.</p>
      <a href="${goHref}" class="btn btn-primary btn-block" style="margin-top:20px">${goText}</a>`;
  } catch (err) {
    stateEl.innerHTML = `
      <div style="font-size:42px;margin-bottom:8px">❌</div>
      <h2 style="color:#e57373;margin:0 0 8px">Xác minh thất bại</h2>
      <p style="color:#8899aa;font-size:14px">${err.message || 'Mã xác minh không hợp lệ hoặc đã được dùng.'}</p>
      <a href="#/login" class="btn btn-primary btn-block" style="margin-top:18px">Về trang đăng nhập</a>`;
  }
}
