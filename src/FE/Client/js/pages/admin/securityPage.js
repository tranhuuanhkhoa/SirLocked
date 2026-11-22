import QRCode from 'qrcode';
import { authApi } from '../../api/authApi.js';
import { session } from '../../services/session.js';
import { tr } from '../../services/i18n.js';
import { escapeHtml, render } from '../../utils/dom.js';

export async function renderAdminSecurityPage(app) {
  let setup = null;
  let recoveryCodes = null;
  render(app, `
    <section class="page adm-security">
      <header class="adm-page-head"><div><p class="adm-eyebrow">ADMIN SECURITY</p><h1>${tr('Security', 'Bảo mật')}</h1></div></header>
      <div class="adm-security-card" data-security-status></div>
      <div class="adm-security-card" data-security-setup hidden></div>
      <div class="adm-security-card" data-security-recovery hidden></div>
      <div class="adm-security-card" data-security-disable hidden></div>
      <p data-security-error class="adm-security-error" role="alert" hidden></p>
    </section>`);

  const statusHost = app.querySelector('[data-security-status]');
  const setupHost = app.querySelector('[data-security-setup]');
  const recoveryHost = app.querySelector('[data-security-recovery]');
  const disableHost = app.querySelector('[data-security-disable]');
  const errorHost = app.querySelector('[data-security-error]');
  const reportError = (error) => {
    errorHost.hidden = false;
    errorHost.textContent = error?.message || tr('The security request failed.', 'Không thể thực hiện yêu cầu bảo mật.');
  };
  const draw = async () => {
    const enabled = session.user()?.twoFactorEnabled === true;
    statusHost.innerHTML = `
      <h2>${tr('Two-factor authentication', 'Xác thực hai bước')}</h2>
      <p>${enabled
    ? tr('Enabled. Admin sign-ins require an authenticator or recovery code.', 'Đã bật. Đăng nhập quản trị cần mã xác thực hoặc mã khôi phục.')
    : tr('Not enabled. Set it up to protect admin sign-ins.', 'Chưa bật. Hãy thiết lập để bảo vệ đăng nhập quản trị.')}</p>
      ${enabled ? '' : `<button class="btn btn-primary" type="button" data-security-start>${tr('Set up 2FA', 'Thiết lập 2FA')}</button>`}`;
    disableHost.hidden = !enabled;
    if (enabled) {
      disableHost.innerHTML = `
        <h2>${tr('Disable two-factor authentication', 'Tắt xác thực hai bước')}</h2>
        <label>${tr('Current authenticator or recovery code', 'Mã xác thực hoặc mã khôi phục')}
          <input data-security-disable-code autocomplete="one-time-code" maxlength="32">
        </label>
        <button class="btn btn-ghost" type="button" data-security-disable-button>${tr('Disable 2FA', 'Tắt 2FA')}</button>`;
    }
  };

  statusHost.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-security-start]')) return;
    errorHost.hidden = true;
    try {
      setup = await authApi.setupAdminTwoFactor();
      const qr = await QRCode.toDataURL(setup.otpauthUri, { width: 220, margin: 1 });
      setupHost.hidden = false;
      setupHost.innerHTML = `
        <h2>${tr('Scan this QR code', 'Quét mã QR này')}</h2>
        <img class="adm-security-qr" alt="${tr('Authenticator setup QR code', 'Mã QR thiết lập ứng dụng xác thực')}" src="${qr}">
        <p>${tr('Or enter the secret manually:', 'Hoặc nhập mã bí mật thủ công:')} <code>${escapeHtml(setup.secret)}</code></p>
        <label>${tr('Six-digit authenticator code', 'Mã sáu chữ số')}
          <input data-security-enable-code inputmode="numeric" autocomplete="one-time-code" maxlength="6">
        </label>
        <button class="btn btn-primary" type="button" data-security-enable>${tr('Enable 2FA', 'Bật 2FA')}</button>`;
    } catch (error) {
      reportError(error);
    }
  });

  setupHost.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-security-enable]')) return;
    try {
      const code = setupHost.querySelector('[data-security-enable-code]').value;
      const result = await authApi.enableAdminTwoFactor(code);
      recoveryCodes = result.recoveryCodes || [];
      const user = session.user() || {};
      session.save({ token: session.token(), user: { ...user, twoFactorEnabled: true }, refreshTokenExpiry: localStorage.getItem('sirlocked.refreshExpiry') });
      setupHost.hidden = true;
      recoveryHost.hidden = false;
      recoveryHost.innerHTML = `
        <h2>${tr('Save your recovery codes', 'Lưu mã khôi phục')}</h2>
        <p>${tr('Each code works once. Store them somewhere safe; they will not be shown again.', 'Mỗi mã chỉ dùng một lần. Hãy cất giữ an toàn; các mã sẽ không được hiển thị lại.')}</p>
        <pre data-security-codes>${recoveryCodes.map(escapeHtml).join('\n')}</pre>
        <button class="btn btn-ghost" type="button" data-security-copy>${tr('Copy codes', 'Sao chép mã')}</button>`;
      await draw();
    } catch (error) {
      reportError(error);
    }
  });

  recoveryHost.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-security-copy]')) return;
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    event.target.textContent = tr('Copied', 'Đã sao chép');
  });

  disableHost.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-security-disable-button]')) return;
    try {
      await authApi.disableAdminTwoFactor(disableHost.querySelector('[data-security-disable-code]').value);
      const user = session.user() || {};
      session.save({ token: session.token(), user: { ...user, twoFactorEnabled: false }, refreshTokenExpiry: localStorage.getItem('sirlocked.refreshExpiry') });
      await draw();
    } catch (error) {
      reportError(error);
    }
  });

  await draw();
}
