import { session } from '../services/session.js';

/**
 * Shared API client. All backend responses use the { success, message, data, errors }
 * envelope; this unwraps data and throws { status, message, errors } on failure.
 */
export async function apiFetch(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
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
export const post = (path, body) => apiFetch('POST', path, body ?? {});
export const patch = (path, body) => apiFetch('PATCH', path, body ?? {});
