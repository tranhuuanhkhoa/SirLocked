import { tr } from '../services/i18n.js';

export function showTwoFactorLoginPrompt(form, error) {
  const code = error?.errors?.code ?? error?.data?.errors?.code;
  if (code !== 'TWO_FACTOR_REQUIRED' && code !== 'TWO_FACTOR_INVALID') return null;

  let field = form.querySelector('[data-two-factor-login]');
  if (!field) {
    const admin = form.classList.contains('adm-login-form');
    field = document.createElement('label');
    field.className = admin ? 'adm-login-field' : 'bpa-auth-field';
    field.dataset.twoFactorLogin = '';
    field.innerHTML = `
      <span>${tr('Two-factor or recovery code', 'Mã xác thực hai bước hoặc mã khôi phục')}</span>
      <input name="twoFactorCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="32" spellcheck="false">
      <span data-two-factor-message role="alert"></span>`;
    form.querySelector('button[type="submit"]').before(field);
    field.querySelector('input').addEventListener('input', () => {
      field.querySelector('[data-two-factor-message]').textContent = '';
    });
  }

  field.querySelector('input').focus();
  return code === 'TWO_FACTOR_REQUIRED'
    ? tr('Enter your authenticator or recovery code.', 'Nhập mã từ ứng dụng xác thực hoặc mã khôi phục.')
    : tr('That code is invalid or has already been used.', 'Mã không hợp lệ hoặc đã được sử dụng.');
}
