import { authApi } from '../api/authApi.js';
import { icon } from '../components/admin/icons.js';
import { session } from '../services/session.js';
import { navigate } from '../services/navigation.js';
import { languageSwitchMarkup, tr } from '../services/i18n.js';
import { escapeHtml, qs, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { wireRevealButtons } from './loginPage.js';

function refusal(error) {
  if (error.status === 401) return tr('Wrong email or password.', 'Sai email hoặc mật khẩu.');
  if (error.status === 403) return tr('This account has no admin access, or it is locked.', 'Tài khoản này không có quyền admin hoặc đã bị khóa.');
  if (error.status === 429) return tr('Too many tries. Wait a minute and try again.', 'Thử quá nhiều lần. Đợi 1 phút rồi thử lại.');
  return error.message;
}

/**
 * The admins' own sign-in page; /login is the players'. Someone signed in with a player account still gets the form, since this
 * is how they reach the admin account, and the session they have is only replaced once the server accepts the admin one.
 * Drawn in the admin "paper file" look (css/60-admin-theme.css, .adm-login): navy panel on the left, the form on the right.
 */
export async function renderAdminLoginPage(app) {
  if (session.isAdmin()) {
    navigate('/admin', { replace: true });
    return;
  }
  const current = session.user();

  render(app, `
    <div class="adm-login">
      <aside class="adm-login-side">
        <span class="adm-login-brand">${icon('compass', 40)}<span>SIR LOCKED</span></span>
        <div class="adm-login-pitch">
          <span class="adm-login-eyebrow">${tr('Restricted area', 'Khu vực hạn chế')}</span>
          <p class="adm-login-big">${tr('Sir Locked admin desk', 'Bảng quản trị Sir Locked')}</p>
          <p class="adm-login-lede">${tr(
    'Cases, chests, cosmetics, players and the game economy in one place.',
    'Quản lý vụ án, hòm, mỹ phẩm, người chơi và kinh tế của game trong một nơi.',
  )}</p>
        </div>
        <span class="adm-login-foot">sirlocked.id.vn/admin</span>
      </aside>
      <div class="adm-login-main">
        <div class="adm-login-lang">${languageSwitchMarkup('adm-login-switch')}</div>
        <section class="adm-login-card" aria-labelledby="admin-login-title">
          <div>
            <h1 id="admin-login-title">${tr('Admin sign-in', 'Đăng nhập quản trị')}</h1>
            <p class="adm-login-sub">${tr('For admin accounts only.', 'Chỉ dành cho tài khoản admin.')}</p>
          </div>
          ${current ? `
            <div class="bpa-auth-note adm-login-note">
              <p>${tr(
    `You are signed in as <b>${escapeHtml(current.fullName)}</b>. Signing in here replaces that session.`,
    `Bạn đang đăng nhập với tên <b>${escapeHtml(current.fullName)}</b>. Đăng nhập ở đây sẽ thay thế phiên đó.`,
  )}</p>
            </div>` : ''}
          <div id="admin-login-error"></div>
          <form id="form-admin-login" class="adm-login-form">
            <label class="adm-login-field" for="admin-login-email">
              <span>Email</span>
              <input id="admin-login-email" name="email" type="email" required autocomplete="email" placeholder="admin@sirlocked.id.vn">
            </label>
            <div class="adm-login-field">
              <label for="admin-login-password">${tr('Password', 'Mật khẩu')}</label>
              <span class="adm-login-pass">
                <input id="admin-login-password" name="password" type="password" required autocomplete="current-password" spellcheck="false">
                <button type="button" class="adm-login-reveal" data-reveal="admin-login-password" aria-pressed="false"
                        aria-label="${tr('Show password', 'Hiện mật khẩu')}">${icon('magnifier', 20)}</button>
              </span>
            </div>
            <button class="adm-login-submit" type="submit"><span>${tr('Log in', 'Đăng nhập')}</span></button>
          </form>
          <a href="/login" class="adm-login-back">${tr('To the player sign-in page', 'Về trang đăng nhập người chơi')}</a>
          <p class="bpa-sr" role="status" id="auth-status"></p>
        </section>
      </div>
    </div>`);
  wireRevealButtons(app);

  const form = qs('#form-admin-login', app);
  const button = form.querySelector('button[type=submit]');
  const label = button.querySelector('span');
  const idleLabel = label.textContent;
  const errorBox = qs('#admin-login-error', app);
  const status = qs('#auth-status', app);

  function setBusy(busy) {
    const busyLabel = tr('Checking…', 'Đang kiểm tra…');
    button.disabled = busy;
    label.textContent = busy ? busyLabel : idleLabel;
    status.textContent = busy ? busyLabel : '';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.innerHTML = '';
    setBusy(true);
    try {
      const data = new FormData(form);
      const auth = await authApi.adminLogin(data.get('email'), data.get('password'));
      if (!app.isConnected) return;
      session.save(auth);
      toast(tr(`Welcome, ${auth.user.fullName}.`, `Chào mừng, ${auth.user.fullName}.`), 'success');
      navigate('/admin');
    } catch (error) {
      errorBox.innerHTML = `<div class="adm-login-alert" role="alert">${escapeHtml(refusal(error))}</div>`;
    } finally {
      setBusy(false);
    }
  });
}
