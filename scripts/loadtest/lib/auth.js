import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

export const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:5515').replace(/\/+$/, '');
const REFRESH_COOKIE = 'sirlocked_refresh';
const SEPARATOR = '\u001e';

const hostMatch = BASE_URL.match(/^https?:\/\/(\[[^\]]+\]|[^/:?#]+)/i);
if (!hostMatch) throw new Error('BASE_URL must be an http(s) URL.');
const hostname = hostMatch[1].replace(/^\[|\]$/g, '').toLowerCase();
const ipv4Parts = hostname.split('.');
const isIpv4Loopback = ipv4Parts.length === 4 && ipv4Parts[0] === '127' &&
  ipv4Parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
const isLoopback = hostname === 'localhost' || hostname === '::1' || isIpv4Loopback;
if (!isLoopback && __ENV.ALLOW_REMOTE !== '1') {
  throw new Error('BASE_URL must use localhost or a loopback IP unless ALLOW_REMOTE=1.');
}

export function request(method, path, token, body, kind = 'api', extra = {}) {
  const headers = { ...extra.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return http.request(method, `${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), {
    headers,
    tags: { kind },
    ...extra,
  });
}

function responseData(response) {
  try { return response.json()?.data; } catch { return null; }
}

function cookieValue(response) {
  return response.cookies?.[REFRESH_COOKIE]?.[0]?.value || '';
}

export function prepareUsers(count) {
  const users = [];
  for (let id = 1; id <= count; id++) {
    const email = `loadtest+${id}@sirlocked.test`;
    const password = `Loadtest-${id}-secret`;
    const body = { fullName: `LoadTest VU ${id}`, email, password };
    const registered = request('POST', '/api/auth/register', null, body, 'auth', {
      responseCallback: http.expectedStatuses(200, 409),
    });
    let response = registered;
    if (registered.status === 409) {
      response = request('POST', '/api/auth/login', null, { email, password }, 'auth');
    }
    const auth = responseData(response);
    check(response, { 'synthetic user authenticated': r => r.status === 200 && Boolean(auth?.token) });
    if (response.status !== 200 || !auth?.token) throw new Error(`Could not authenticate ${email}.`);
    users.push({ email, password, fullName: body.fullName, token: auth.token, refreshCookie: cookieValue(response), issuedAt: Date.now() });
  }
  return users;
}

export function userForVu(data) {
  return data.users[exec.vu.idInTest - 1];
}

export function freshToken(user) {
  if (Date.now() - user.issuedAt < 55 * 60 * 1000) return user.token;
  if (!user.refreshCookie) throw new Error('Refresh cookie is unavailable for an expired access token.');
  const response = http.post(`${BASE_URL}/api/auth/refresh`, null, {
    headers: { Cookie: `${REFRESH_COOKIE}=${user.refreshCookie}`, 'X-SirLocked-Client': 'web' },
    tags: { kind: 'auth' },
  });
  const auth = responseData(response);
  check(response, { 'access token refreshed': r => r.status === 200 && Boolean(auth?.token) });
  if (response.status !== 200 || !auth?.token) throw new Error('Access-token refresh failed.');
  user.token = auth.token;
  user.refreshCookie = cookieValue(response) || user.refreshCookie;
  user.issuedAt = Date.now();
  return user.token;
}

export function authHeaders(user, kind = 'api') {
  return { headers: { Authorization: `Bearer ${freshToken(user)}`, 'Content-Type': 'application/json' }, tags: { kind } };
}

export { SEPARATOR };
