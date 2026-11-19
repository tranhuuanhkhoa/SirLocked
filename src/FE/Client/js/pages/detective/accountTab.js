import { authApi } from '../../api/authApi.js';
import { authErrorMessage } from '../../services/authErrorMessages.js';
import { tr } from '../../services/i18n.js';
import { escapeHtml } from '../../utils/dom.js';
import { toast } from '../../utils/toast.js';

export const ICON_ALERT = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5L2.8 19.5h18.4z"></path><path d="M12 9.5v4.5"></path><path d="M12 17v.01"></path></svg>';
const ICON_OK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.8 2.8L16.5 9.5"></path></svg>';
const ICON_MAIL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="1.5"></rect><path d="M3.5 6.5l8.5 6.5 8.5-6.5"></path></svg>';
const ICON_EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const ICON_LOCK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="1.5"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path><path d="M12 14.5v2.5"></path></svg>';
const ICON_RULE_NO = '<svg class="bpa-profile-rule-no" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle></svg>';
const ICON_RULE_OK = '<svg class="bpa-profile-rule-ok" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"></path></svg>';

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!name || !domain) return '';
  const masked = name.length <= 2 ? `${name[0]}•••` : `${name[0]}•••${name[name.length - 1]}`;
  return `${masked}@${domain}`;
}

function accountHtml(profile, sessionUser) {
  const email = maskEmail(sessionUser?.email);
  const verified = !!profile.isEmailVerified;
  return `
    <section id="bpa-profile-account" class="bpa-paper bpa-paper--card bpa-profile-acct" aria-labelledby="bpa-profile-acct-h" tabindex="-1">
      <span class="bpa-pin" aria-hidden="true"></span>
      <div class="bpa-profile-stampbox" aria-hidden="true">
        <span class="bpa-stamp ${verified ? 'bpa-stamp--teal' : ''} bpa-profile-stamp">${escapeHtml(verified ? tr('Verified', 'Đã xác minh') : tr('Not verified', 'Chưa xác minh'))}</span>
      </div>
      <p class="bpa-kicker bpa-profile-kick">${escapeHtml(tr('Form · Confidential', 'Mẫu khai · Bảo mật'))}</p>
      <h2 id="bpa-profile-acct-h" class="bpa-profile-h2">${escapeHtml(tr('Account', 'Tài khoản'))}</h2>

      <div class="bpa-profile-acct-body${profile.hasPassword ? ' has-password' : ''}">
      <div class="bpa-profile-acct-email">
      ${email ? `
        <div class="bpa-profile-emailrow">
          <span class="bpa-profile-label">${escapeHtml(tr('Email', 'Email'))}</span>
          <span class="bpa-profile-emailval">${escapeHtml(email)}</span>
        </div>` : ''}

      ${verified ? `
        <p class="bpa-profile-okline">${ICON_OK}${escapeHtml(tr('Email verified', 'Email đã được xác minh'))}</p>` : `
        <div class="bpa-profile-verify">
          <div class="bpa-profile-note bpa-profile-note--warn">
            ${ICON_ALERT}
            <div><strong>${escapeHtml(tr('Email not verified', 'Email chưa xác minh'))}</strong>${escapeHtml(tr('You need to verify your email to enter a game. Check your inbox and open the link in the email.', 'Bạn cần xác minh email để vào game. Hãy kiểm tra hộp thư và nhấn liên kết trong email.'))}</div>
          </div>
          <button type="button" class="bpa-btn bpa-btn--ink bpa-profile-resend" id="btn-resend-verify">
            ${ICON_MAIL}${escapeHtml(tr('Resend verification email', 'Gửi lại email xác minh'))}
          </button>
          <div id="verify-token-result" role="status"></div>
        </div>`}
      </div>

      ${profile.hasPassword ? `
        <form id="form-change-password" class="bpa-profile-pwform" aria-labelledby="bpa-profile-pw-h">
          <div class="bpa-profile-pwhead">
            <h3 id="bpa-profile-pw-h" class="bpa-profile-h3">${escapeHtml(tr('Change password', 'Đổi mật khẩu'))}</h3>
            <button type="button" class="bpa-profile-eye" id="bpa-profile-pw-toggle" aria-pressed="false">
              ${ICON_EYE}${escapeHtml(tr('Show', 'Hiện'))}<span class="bpa-sr"> ${escapeHtml(tr('passwords', 'mật khẩu'))}</span>
            </button>
          </div>
          <div class="bpa-profile-fieldwrap">
            <label class="bpa-field-label bpa-profile-label" for="bpa-profile-pw-cur">${escapeHtml(tr('Current password', 'Mật khẩu hiện tại'))}</label>
            <input class="bpa-field bpa-profile-input" id="bpa-profile-pw-cur" name="currentPassword" type="password" required autocomplete="current-password">
          </div>
          <div class="bpa-profile-fieldwrap">
            <label class="bpa-field-label bpa-profile-label" for="bpa-profile-pw-new">${escapeHtml(tr('New password', 'Mật khẩu mới'))}
              <span class="bpa-profile-hint">${escapeHtml(tr('(at least 6 characters, letters and numbers)', '(tối thiểu 6 ký tự, gồm chữ và số)'))}</span>
            </label>
            <input class="bpa-field bpa-profile-input" id="bpa-profile-pw-new" name="newPassword" type="password" required minlength="6" autocomplete="new-password" aria-describedby="bpa-profile-pw-rules">
            <ul id="bpa-profile-pw-rules" class="bpa-profile-rules">
              <li class="bpa-profile-rule" data-rule="len">${ICON_RULE_NO}${ICON_RULE_OK}${escapeHtml(tr('At least 6 characters', 'Ít nhất 6 ký tự'))}</li>
              <li class="bpa-profile-rule" data-rule="mix">${ICON_RULE_NO}${ICON_RULE_OK}${escapeHtml(tr('Letters and numbers', 'Có cả chữ và số'))}</li>
            </ul>
          </div>
          <div class="bpa-profile-fieldwrap">
            <label class="bpa-field-label bpa-profile-label" for="bpa-profile-pw-conf">${escapeHtml(tr('Confirm new password', 'Xác nhận mật khẩu mới'))}</label>
            <input class="bpa-field bpa-profile-input" id="bpa-profile-pw-conf" name="confirmPassword" type="password" required minlength="6" autocomplete="new-password">
          </div>
          <button class="bpa-btn bpa-btn--red bpa-btn--block bpa-profile-save" type="submit">
            ${ICON_LOCK}${escapeHtml(tr('Save password', 'Lưu mật khẩu'))}
          </button>
        </form>` : ''}
      </div>
    </section>`;
}

function wireResend(root) {
  const button = root.querySelector('#btn-resend-verify');
  if (!button) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await authApi.resendVerification();
      root.querySelector('#verify-token-result').innerHTML = `
        <p class="bpa-profile-note bpa-profile-note--ok bpa-profile-reveal">
          ${ICON_OK}
          <span>${escapeHtml(tr('A new verification email is on its way. Check your inbox (and the Spam folder), then open the link in the email.', 'Đã gửi lại email xác minh. Kiểm tra hộp thư (cả mục Spam) rồi nhấn liên kết trong email.'))}</span>
        </p>`;
    } catch (err) {
      toast(authErrorMessage(err.message), 'error');
    } finally {
      button.disabled = false;
    }
  });
}

function wirePassword(root) {
  const form = root.querySelector('#form-change-password');
  if (!form) return;
  const inputs = [...form.querySelectorAll('input')];
  const newInput = form.querySelector('[name=newPassword]');
  const confirmInput = form.querySelector('[name=confirmPassword]');
  const toggle = form.querySelector('#bpa-profile-pw-toggle');

  toggle.addEventListener('click', () => {
    const show = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(show));
    inputs.forEach((input) => { input.type = show ? 'text' : 'password'; });
  });

  // Live hints only; the rules themselves are enforced by the server.
  const updateRules = () => {
    const value = String(newInput.value || '');
    const checks = {
      len: value.length >= 6,
      mix: /[A-Za-zÀ-ỹ]/.test(value) && /\d/.test(value),
    };
    form.querySelectorAll('[data-rule]').forEach((li) => {
      li.classList.toggle('is-ok', !!checks[li.dataset.rule]);
    });
  };
  newInput.addEventListener('input', updateRules);
  confirmInput.addEventListener('input', () => confirmInput.removeAttribute('aria-invalid'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const currentPassword = data.get('currentPassword');
    const newPassword = data.get('newPassword');
    const confirmPassword = data.get('confirmPassword');

    if (newPassword !== confirmPassword) {
      confirmInput.setAttribute('aria-invalid', 'true');
      toast(tr('The confirmation password does not match.', 'Mật khẩu xác nhận không khớp.'), 'error');
      return;
    }

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast(tr('Password changed!', 'Đổi mật khẩu thành công!'), 'success');
      form.reset();
      updateRules();
    } catch (err) {
      toast(authErrorMessage(err.message), 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

/** Email verification and the password: the one place a detective can change them, so they keep a tab of their own. */
export function accountTab(profile, sessionUser) {
  return {
    id: 'taikhoan',
    label: () => tr('Account', 'Tài khoản'),
    render(panel) {
      panel.innerHTML = accountHtml(profile, sessionUser);
      wireResend(panel);
      wirePassword(panel);
    },
  };
}
