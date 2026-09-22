import { authApi } from '../api/authApi.js';
import { session } from '../services/session.js';
import { render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderVerifyNoticePage(app) {
  const user = session.user();
  const email = user?.email ? `<b style="color:#d8ae52">${user.email}</b>` : 'email của bạn';

  render(app, `
  <div class="auth-screen">
    <div class="auth-panel">
      <div class="auth-logo"><h1>SIR LOCKED</h1><p>The Mystery Awaits</p></div>
      <div class="gold-divider"></div>
      <div style="text-align:center;padding:6px 0">
        <div style="font-size:48px;margin-bottom:10px">📬</div>
        <h2 style="color:#d8ae52;margin:0 0 10px">Kiểm tra email của bạn</h2>
        <p style="color:#cfc7b2;font-size:14px;line-height:1.6">
          Chúng tôi đã gửi một liên kết xác minh tới ${email}.<br>
          Hãy mở email và nhấn <b>"Xác minh tài khoản"</b> để kích hoạt và vào game.
        </p>
        <p style="color:#8899aa;font-size:12px;margin-top:10px">Không thấy email? Kiểm tra cả mục <b>Spam / Quảng cáo</b>.</p>

        <div id="resend-result" style="margin-top:14px"></div>
        <button class="btn btn-ghost btn-block" id="btn-resend" style="margin-top:14px">Gửi lại email xác minh</button>
        <p style="text-align:center;margin-top:12px">
          <a href="#/login" id="link-logout" style="color:#d8ae52;font-size:13px">Đăng nhập bằng tài khoản khác</a>
        </p>
      </div>
    </div>
  </div>`);

  qs('#btn-resend', app).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await authApi.resendVerification();
      qs('#resend-result', app).innerHTML =
        `<p style="color:#7ecf7e;font-size:13px;margin:0">✅ Đã gửi lại email. Vui lòng kiểm tra hộp thư.</p>`;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  qs('#link-logout', app).addEventListener('click', (e) => {
    e.preventDefault();
    session.clear();
    window.location.hash = '#/login';
  });
}
