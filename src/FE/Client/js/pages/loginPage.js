import { authApi } from '../api/authApi.js';
import { session } from '../services/session.js';
import { render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { languageSwitchMarkup, tr } from '../services/i18n.js';

export async function renderLoginPage(app) {
  if (session.isLoggedIn()) {
    window.location.hash = session.isAdmin() ? '#/admin' : '#/menu';
    return;
  }

  render(app, `
  <div class="auth-screen">
    <div class="auth-panel">
      ${languageSwitchMarkup('ui-language-switch-auth')}
      <div class="auth-logo">
        <h1>SIR LOCKED</h1>
        <p>${tr('The Mystery Awaits', 'Bí ẩn đang chờ đợi')}</p>
      </div>
      <div class="gold-divider"></div>
      <div class="tab-row">
        <button class="form-tab active" data-tab="login">${tr('Log in', 'Đăng nhập')}</button>
        <button class="form-tab" data-tab="register">${tr('Register', 'Đăng ký')}</button>
      </div>

      <form id="form-login" class="auth-form">
        <label class="field-label">Email
          <input class="field-input" name="email" type="email" required autocomplete="email" placeholder="detective@sirlocked.local">
        </label>
        <label class="field-label">${tr('Password', 'Mật khẩu')}
          <input class="field-input" name="password" type="password" required autocomplete="current-password" placeholder="••••••••">
        </label>
        <button class="btn btn-primary btn-block" type="submit">${tr('Log in', 'Đăng nhập')}</button>
        <p style="text-align:center;margin-top:8px">
          <a href="#" id="link-forgot" style="color:#d8ae52;font-size:13px">${tr('Forgot password?', 'Quên mật khẩu?')}</a>
        </p>
      </form>

      <form id="form-register" class="auth-form" hidden>
        <label class="field-label">${tr('Full name', 'Họ và tên')}
          <input class="field-input" name="fullName" type="text" required minlength="2" placeholder="Detective Holmes">
        </label>
        <label class="field-label">Email
          <input class="field-input" name="email" type="email" required autocomplete="email" placeholder="detective@sirlocked.local">
        </label>
        <label class="field-label">${tr('Password (at least 6 characters, including letters and numbers)', 'Mật khẩu (tối thiểu 6 ký tự, gồm chữ và số)')}
          <input class="field-input" name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="••••••••">
        </label>
        <button class="btn btn-primary btn-block" type="submit">${tr('Create account', 'Tạo tài khoản')}</button>
      </form>

      <form id="form-forgot" class="auth-form" hidden>
        <p style="color:#efe7d2;font-size:13px;margin-bottom:12px">${tr('Enter your email to receive a password reset link.', 'Nhập email để nhận liên kết đặt lại mật khẩu.')}</p>
        <label class="field-label">Email
          <input class="field-input" name="email" type="email" required placeholder="detective@sirlocked.local">
        </label>
        <button class="btn btn-primary btn-block" type="submit">${tr('Send request', 'Gửi yêu cầu')}</button>
        <div id="forgot-result" style="margin-top:12px"></div>
        <p style="text-align:center;margin-top:8px">
          <a href="#" id="link-back-login" style="color:#d8ae52;font-size:13px">${tr('← Back to login', '← Quay lại đăng nhập')}</a>
        </p>
      </form>

      <div class="gold-divider" style="margin:16px 0"></div>
      <a href="/api/auth/google" class="btn btn-block"
         style="display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#333;border:1px solid #ddd;text-decoration:none;padding:10px;border-radius:6px;font-weight:600">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
        ${tr('Continue with Google', 'Đăng nhập với Google')}
      </a>

      <p class="auth-hint">${tr('Two detectives. One locked case.', 'Hai thám tử. Một vụ án bí ẩn.')}</p>
    </div>
  </div>`);

  const tabs = app.querySelectorAll('.form-tab');
  tabs.forEach((tab) =>
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      qs('#form-login', app).hidden = tab.dataset.tab !== 'login';
      qs('#form-register', app).hidden = tab.dataset.tab !== 'register';
    }));

  async function submit(form, action) {
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const data = new FormData(form);
      const auth = await action(data);
      session.save(auth);
      toast(`Welcome, ${auth.user.fullName}.`, 'success');
      window.location.hash = auth.user.role === 'ADMIN' ? '#/admin' : '#/menu';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function showForm(name) {
    qs('#form-login', app).hidden = name !== 'login';
    qs('#form-register', app).hidden = name !== 'register';
    qs('#form-forgot', app).hidden = name !== 'forgot';
    tabs.forEach((t) => t.classList.toggle('active',
      (name === 'login' && t.dataset.tab === 'login') ||
      (name === 'register' && t.dataset.tab === 'register')));
  }

  qs('#form-login', app).addEventListener('submit', (e) => {
    e.preventDefault();
    submit(e.target, (d) => authApi.login(d.get('email'), d.get('password')));
  });

  qs('#form-register', app).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const d = new FormData(form);
      const auth = await authApi.register(d.get('fullName'), d.get('email'), d.get('password'));
      session.save(auth);
      // Chưa xác minh → đưa sang trang nhắc kiểm tra email (không vào game ngay)
      window.location.hash = '#/verify-notice';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  qs('#link-forgot', app).addEventListener('click', (e) => {
    e.preventDefault();
    showForm('forgot');
  });

  qs('#link-back-login', app).addEventListener('click', (e) => {
    e.preventDefault();
    showForm('login');
  });

  qs('#form-forgot', app).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const data = new FormData(e.target);
      await authApi.forgotPassword(data.get('email'));
      const resultDiv = qs('#forgot-result', app);
      resultDiv.innerHTML = `
        <div style="background:#1a2a1a;border:1px solid #4a7a4a;border-radius:6px;padding:12px;font-size:13px">
          <p style="color:#7ecf7e;margin:0 0 6px">✅ Đã gửi email!</p>
          <p style="color:#cfc7b2;margin:0">Nếu email tồn tại, chúng tôi đã gửi một liên kết đặt lại mật khẩu. Hãy mở email (kiểm tra cả mục Spam) và nhấn vào nút trong đó.</p>
        </div>`;
      e.target.querySelector('input[name=email]').value = '';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}
