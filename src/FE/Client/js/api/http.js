import { session } from '../services/session.js';
import { authSnapshot, canRetryForAccount, expireSessionIfCurrent, isPublicAuthRequest, refreshAfterUnauthorized } from '../services/authRefresh.js';

/**
 * Shared API client. All backend responses use the { success, message, data, errors }
 * envelope; this unwraps data and throws { status, message, errors } on failure.
 */
export async function apiFetch(method, path, body, _retry = true, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  const requestSession = authSnapshot();
  const token = requestSession.token;
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
    if (response.status === 401 && token && !isPublicAuthRequest(path)) {
      if (_retry) {
        const refreshed = await refreshAfterUnauthorized(requestSession);
        if (refreshed && canRetryForAccount(requestSession)) {
          return apiFetch(method, path, body, false, extraHeaders);
        }
      } else {
        expireSessionIfCurrent(requestSession);
      }
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
export const post = (path, body, options = {}) => apiFetch('POST', path, body ?? {}, true, options.headers ?? {});
export const put = (path, body) => apiFetch('PUT', path, body ?? {});
export const patch = (path, body) => apiFetch('PATCH', path, body ?? {});
