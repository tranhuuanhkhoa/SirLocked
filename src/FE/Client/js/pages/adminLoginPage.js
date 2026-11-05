import '../../../css/22-bpa-auth.css';
import { authApi } from '../api/authApi.js';
import { session } from '../services/session.js';
import { navigate } from '../services/navigation.js';
import { tr } from '../services/i18n.js';
import { escapeHtml, qs, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { ICON_ARROW, authHead, loginBoardMarkup, passwordField, setBoardState, wireRevealButtons } from './loginPage.js';

const ICON_ALERT = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7a3f27" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>';

function refusal(error) {
  if (error.status === 401) return tr('Wrong email or password.', 'Sai email hoặc mật khẩu.');
  if (error.status === 403) return tr('This account has no admin access, or it is locked.', 'Tài khoản này không có quyền admin hoặc đã bị khóa.');
  if (error.status === 429) return tr('Too many tries. Wait a minute and try again.', 'Thử quá nhiều lần. Đợi 1 phút rồi thử lại.');
  return error.message;
}

/**
 * The admins' own sign-in page; /login is the players'. Someone signed in with a player account still gets the form, since this
 * is how they reach the admin account, and the session they have is only replaced once the server accepts the admin one.
 */
export async function renderAdminLoginPage(app) {
  if (session.isAdmin()) {
    navigate('/admin', { replace: true });
    return;
  }
  const current = session.user();

  const body = `
    <section class="bpa-auth-section bpa-auth-rise-late" aria-labelledby="admin-login-title">
      <div class="bpa-auth-card">
        <span class="bpa-auth-pin" aria-hidden="true"></span>
        ${authHead(tr('Restricted area', 'Khu vực hạn chế'), 'ADMIN')}
        <h2 id="admin-login-title" class="bpa-auth-title">${tr('Admin sign-in', 'Đăng nhập quản trị')}</h2>
        <p class="bpa-auth-sub">${tr('For admin accounts only.', 'Chỉ dành cho tài khoản admin.')}</p>
        ${current ? `
          <div class="bpa-auth-note bpa-auth-note--memo">
            <p>${tr(
              `You are signed in as <b>${escapeHtml(current.fullName)}</b>. Signing in here replaces that session.`,
              `Bạn đang đăng nhập với tên <b>${escapeHtml(current.fullName)}</b>. Đăng nhập ở đây sẽ thay thế phiên đó.`,
            )}</p>
          </div>` : ''}
        <div id="admin-login-error"></div>
        <form id="form-admin-login" class="bpa-auth-form">
          <div class="bpa-auth-field">
            <label for="admin-login-email" class="bpa-auth-flabel"><span aria-hidden="true">01 — </span>Email</label>
            <input id="admin-login-email" class="bpa-auth-input" name="email" type="email" required autocomplete="email" placeholder="admin@example.com">
          </div>
          ${passwordField({
            id: 'admin-login-password', name: 'password', autocomplete: 'current-password',
            label: `<span aria-hidden="true">02 — </span>${tr('Password', 'Mật khẩu')}`,
          })}
          <button class="bpa-auth-primary" type="submit">
            <span>${tr('Log in', 'Đăng nhập')}</span>${ICON_ARROW}
          </button>
        </form>
        <p class="bpa-auth-center">
          <a href="/login" class="bpa-auth-link is-back"><span aria-hidden="true">←</span><span class="u">${tr('To the player sign-in page', 'Về trang đăng nhập người chơi')}</span></a>
        </p>
        <p class="bpa-sr" role="status" id="auth-status"></p>
      </div>
    </section>`;

  render(app, loginBoardMarkup(body, { notice: Boolean(current) }));
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
    setBoardState(app, busy ? 'solving' : '');
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
      errorBox.innerHTML = `
        <div class="bpa-auth-note bpa-auth-note--warn" role="alert">
          ${ICON_ALERT}
          <p>${escapeHtml(refusal(error))}</p>
        </div>`;
    } finally {
      setBusy(false);
    }
  });
}
