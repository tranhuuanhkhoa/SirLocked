import { authApi } from '../api/authApi.js';
import { render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderResetPasswordPage(app) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const token = params.get('token');

  if (!token) {
    render(app, `
    <div class="auth-screen">
      <div class="auth-panel">
        <div class="auth-logo"><h1>SIR LOCKED</h1><p>The Mystery Awaits</p></div>
        <div class="gold-divider"></div>
        <div style="text-align:center;padding:8px 0">
          <div style="font-size:42px;margin-bottom:8px">⚠️</div>
          <h2 style="color:#f0c060;margin:0 0 8px">Liên kết không hợp lệ</h2>
          <p style="color:#8899aa;font-size:14px">Không tìm thấy mã đặt lại trong liên kết.</p>
          <a href="#/login" class="btn btn-primary btn-block" style="margin-top:18px">Về trang đăng nhập</a>
        </div>
      </div>
    </div>`);
    return;
  }

  render(app, `
  <div class="auth-screen">
    <div class="auth-panel">
      <div class="auth-logo"><h1>SIR LOCKED</h1><p>Đặt lại mật khẩu</p></div>
      <div class="gold-divider"></div>
      <form id="form-reset" class="auth-form">
        <p style="color:#cfc7b2;font-size:13px;margin-bottom:14px">Nhập mật khẩu mới cho tài khoản của bạn.</p>
        <label class="field-label">Mật khẩu mới (tối thiểu 6 ký tự, gồm chữ và số)
          <input class="field-input" name="newPassword" type="password" required minlength="6" autocomplete="new-password" placeholder="••••••••">
        </label>
        <label class="field-label">Xác nhận mật khẩu mới
          <input class="field-input" name="confirmPassword" type="password" required minlength="6" autocomplete="new-password" placeholder="••••••••">
        </label>
        <button class="btn btn-primary btn-block" type="submit">Đặt lại mật khẩu</button>
        <p style="text-align:center;margin-top:10px">
          <a href="#/login" style="color:#d8ae52;font-size:13px">← Quay lại đăng nhập</a>
        </p>
      </form>
    </div>
  </div>`);

  qs('#form-reset', app).addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const newPassword = data.get('newPassword');
    const confirmPassword = data.get('confirmPassword');

    if (newPassword !== confirmPassword) {
      toast('Mật khẩu xác nhận không khớp.', 'error');
      return;
    }

    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await authApi.resetPassword(token, newPassword);
      toast('Đặt lại mật khẩu thành công! Hãy đăng nhập lại.', 'success');
      window.location.hash = '#/login';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}
