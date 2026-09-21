import { session } from '../services/session.js';

let isRefreshing = false;
let refreshPromise = null;

async function tryRefreshToken() {
  if (isRefreshing) return refreshPromise;

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken() }),
      });
      if (!res.ok) throw new Error('Refresh failed');
      const payload = await res.json();
      session.save(payload.data);
      return true;
    } catch {
      session.clear();
      window.location.hash = '#/login';
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Shared API client. All backend responses use the { success, message, data, errors }
 * envelope; this unwraps data and throws { status, message, errors } on failure.
 */
export async function apiFetch(method, path, body, _retry = true, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  const token = session.token();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
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
    // Token hết hạn → thử refresh rồi retry 1 lần
    if (response.status === 401 && session.isLoggedIn() && _retry && session.isRefreshTokenValid()) {
      const refreshed = await tryRefreshToken();
      if (refreshed) return apiFetch(method, path, body, false, extraHeaders);
    }
    if (response.status === 401 && session.isLoggedIn()) {
      session.clear();
      window.location.hash = '#/login';
    }
    throw {
      status: response.status,
      message: payload?.message || `Request failed (${response.status}).`,
      errors: payload?.errors ?? null,
    };
  }

  return payload?.data;
}

export async function apiFetchForm(path, formData) {
  const headers = {};
  const token = session.token();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, { method: 'POST', headers, body: formData });
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
    throw {
      status: response.status,
      message: payload?.message || `Request failed (${response.status}).`,
      errors: payload?.errors ?? null,
    };
  }
  return payload?.data;
}

export async function apiFetchBlob(path) {
  const headers = {};
  const token = session.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { headers });
  if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
  return response.blob();
}

export const get = (path) => apiFetch('GET', path);
export const post = (path, body, options = {}) => apiFetch('POST', path, body ?? {}, true, options.headers ?? {});
export const put = (path, body) => apiFetch('PUT', path, body ?? {});
export const patch = (path, body) => apiFetch('PATCH', path, body ?? {});
