import { session } from '../services/session.js';
import { authSnapshot, canRetryForAccount, expireSessionIfCurrent, isPublicAuthRequest, refreshAfterUnauthorized } from '../services/authRefresh.js';
import { tr } from '../services/i18n.js';

let stepUpPrompt = null;

function askForStepUp() {
  if (stepUpPrompt) return stepUpPrompt;
  stepUpPrompt = new Promise((resolve) => {
    const twoFactor = session.user()?.twoFactorEnabled === true;
    const overlay = document.createElement('div');
    overlay.className = 'adm-step-up-overlay';
    overlay.innerHTML = `
      <section class="adm-step-up-modal" role="dialog" aria-modal="true" aria-labelledby="adm-step-up-title">
        <h2 id="adm-step-up-title">${tr('Confirm it is you', 'Xác nhận danh tính')}</h2>
        <p>${tr('This action needs recent authentication.', 'Thao tác này cần xác thực gần đây.')}</p>
        <label>${twoFactor ? tr('Authenticator or recovery code', 'Mã xác thực hoặc mã khôi phục') : tr('Password', 'Mật khẩu')}
          <input data-step-up-input type="${twoFactor ? 'text' : 'password'}" ${twoFactor ? 'autocomplete="one-time-code"' : 'autocomplete="current-password"'} maxlength="100">
        </label>
        <p data-step-up-error role="alert" hidden></p>
        <div class="adm-step-up-actions">
          <button type="button" data-step-up-cancel>${tr('Cancel', 'Hủy')}</button>
          <button type="button" data-step-up-confirm>${tr('Continue', 'Tiếp tục')}</button>
        </div>
      </section>`;
    document.body.append(overlay);
    const input = overlay.querySelector('[data-step-up-input]');
    const confirm = overlay.querySelector('[data-step-up-confirm]');
    const error = overlay.querySelector('[data-step-up-error]');
    const finish = (result) => {
      overlay.remove();
      resolve(result);
      stepUpPrompt = null;
    };
    overlay.querySelector('[data-step-up-cancel]').addEventListener('click', () => finish(false));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(false);
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish(false);
    });
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      error.hidden = true;
      try {
        await apiFetch('POST', '/api/auth/admin/step-up', twoFactor
          ? { twoFactorCode: input.value }
          : { password: input.value });
        finish(true);
      } catch (failure) {
        error.textContent = failure?.message || tr('Authentication failed.', 'Xác thực không thành công.');
        error.hidden = false;
        confirm.disabled = false;
        input.focus();
      }
    });
    input.focus();
  });
  return stepUpPrompt;
}

/**
 * VUAN-7: a random id of this browser, so accounts sharing one device count once toward an author's rewards. The
 * server only stores a hash of it with the connection; it identifies nothing outside Sir Locked.
 */
function deviceId() {
  try {
    let id = localStorage.getItem('sirlocked.deviceId');
    if (!id) {
      id = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('sirlocked.deviceId', id);
    }
    return id;
  } catch {
    return '';
  }
}

/**
 * Shared API client. All backend responses use the { success, message, data, errors }
 * envelope; this unwraps data and throws { status, message, errors } on failure.
 */
export async function apiFetch(method, path, body, _retry = true, extraHeaders = {}, credentials = 'same-origin', _stepUpRetry = true) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  const requestSession = authSnapshot();
  const token = requestSession.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const device = token ? deviceId() : '';
  if (device) headers['X-Device-Id'] = device;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw { status: 0, message: 'Cannot reach the server. Is the backend running?', errors: null };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* empty body */
  }

  if (!response.ok) {
    if (response.status === 401 && token && !isPublicAuthRequest(path)) {
      if (_retry) {
        const refreshed = await refreshAfterUnauthorized(requestSession);
        if (refreshed && canRetryForAccount(requestSession)) {
          return apiFetch(method, path, body, false, extraHeaders, credentials, _stepUpRetry);
        }
      } else {
        expireSessionIfCurrent(requestSession);
      }
    }
    const failure = {
      status: response.status,
      message: payload?.message || `Request failed (${response.status}).`,
      errors: payload?.errors ?? null,
    };
    if (_stepUpRetry && response.status === 403 && payload?.errors?.code === 'STEP_UP_REQUIRED') {
      if (await askForStepUp()) return apiFetch(method, path, body, _retry, extraHeaders, credentials, false);
    }
    throw failure;
  }

  return payload?.data;
}

export async function apiFetchForm(path, formData, _retry = true, _stepUpRetry = true) {
  const headers = {};
  const requestSession = authSnapshot();
  const token = requestSession.token;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, { method: 'POST', headers, body: formData, credentials: 'same-origin' });
  } catch {
    throw { status: 0, message: 'Cannot reach the server. Is the backend running?', errors: null };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* empty body */
  }
  if (!response.ok) {
    if (response.status === 401 && token) {
      if (_retry) {
        const refreshed = await refreshAfterUnauthorized(requestSession);
        if (refreshed && canRetryForAccount(requestSession)) return apiFetchForm(path, formData, false, _stepUpRetry);
      } else {
        expireSessionIfCurrent(requestSession);
      }
    }
    const failure = {
      status: response.status,
      message: payload?.message || `Request failed (${response.status}).`,
      errors: payload?.errors ?? null,
    };
    if (_stepUpRetry && response.status === 403 && payload?.errors?.code === 'STEP_UP_REQUIRED') {
      if (await askForStepUp()) return apiFetchForm(path, formData, _retry, false);
    }
    throw failure;
  }
  return payload?.data;
}

/** @param {string} path @param {AbortSignal} [signal] */
export async function apiFetchBlob(path, signal) {
  const headers = {};
  const token = session.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { headers, signal });
  if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
  return response.blob();
}

export const get = (path) => apiFetch('GET', path);
export const post = (path, body, options = {}) => apiFetch('POST', path, body ?? {}, true, options.headers ?? {}, options.credentials ?? 'same-origin');
export const put = (path, body) => apiFetch('PUT', path, body ?? {});
export const patch = (path, body) => apiFetch('PATCH', path, body ?? {});
