import { sessionFor, sessionScope } from './session.js';
import { navigate } from './navigation.js';

const pendingRefreshes = new Map();

/**
 * The session a request starts with, and the side it belongs to: a request started on an admin page refreshes and
 * expires the admin session even if the page has changed since.
 */
export function authSnapshot(scope = sessionScope()) {
  const side = sessionFor(scope);
  return { scope: side.scope, token: side.token(), userId: side.user()?.userId || '' };
}

function sameSession(left, right) {
  return left.scope === right.scope && left.token === right.token && left.userId === right.userId;
}

export function canRetryForAccount(original) {
  const current = authSnapshot(original.scope);
  return Boolean(original.userId && current.token && current.userId === original.userId);
}

function hasNewerSession(original) {
  const current = authSnapshot(original.scope);
  return Boolean(original.userId && current.token && current.userId === original.userId && current.token !== original.token);
}

export function expireSessionIfCurrent(original) {
  if (!original.token || !sameSession(original, authSnapshot(original.scope))) return;
  const side = sessionFor(original.scope);
  const signIn = side.loginAddress();
  side.clear();
  // Only the side on screen goes to its sign-in page; a late answer for the other side just ends that session.
  if (sessionScope() === original.scope) navigate(signIn);
}

export function isPublicAuthRequest(path) {
  const pathname = String(path).split('?')[0];
  return /^\/api\/auth\/(login|admin\/login|register|refresh|forgot-password|reset-password|verify-email|google(?:\/callback)?)\/?$/.test(pathname);
}

export function refreshAfterUnauthorized(original) {
  const key = JSON.stringify(original);
  if (pendingRefreshes.has(key)) return pendingRefreshes.get(key);

  const pending = (async () => {
    try {
      // The lock spans tabs on this origin. Re-read storage after acquiring it:
      // another tab may already have rotated the one-use refresh token. Each side has its own lock.
      if (navigator.locks?.request) {
        return await navigator.locks.request(refreshLock(original.scope), () => refreshCurrentSession(original));
      }
      // Older browsers still share one flight within this tab and preserve newer storage.
      return await refreshCurrentSession(original);
    } finally {
      pendingRefreshes.delete(key);
    }
  })();
  pendingRefreshes.set(key, pending);
  return pending;
}

function refreshLock(scope) {
  return scope === 'admin' ? 'sirlocked.admin.auth-refresh' : 'sirlocked.auth-refresh';
}

async function refreshCurrentSession(original) {
  if (!canRetryForAccount(original)) return false;
  if (hasNewerSession(original)) return true;
  const side = sessionFor(original.scope);
  const starting = authSnapshot(original.scope);
  if (!side.isRefreshTokenValid()) {
    expireSessionIfCurrent(starting);
    return false;
  }

  let response;
  try {
    // The refresh token is this side's HttpOnly cookie; the header names the side, and proves the call comes from this page.
    response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-SirLocked-Client': 'web', 'X-SirLocked-Session': original.scope },
    });
  } catch {
    if (!sameSession(starting, authSnapshot(original.scope))) return hasNewerSession(original);
    // A lost connection is not proof that the shared session was revoked.
    throw { status: 0, message: 'Cannot reach the server. Please try again.', errors: null };
  }

  let payload = null;
  try { payload = await response.json(); } catch { /* A proxy may return a non-JSON failure. */ }

  // Logout, another login or a refresh fallback may change storage while HTTP is pending.
  // An old response must never restore a logged-out account or overwrite the new one.
  if (!sameSession(starting, authSnapshot(original.scope))) return hasNewerSession(original);
  if (response.status === 401 || response.status === 403) {
    expireSessionIfCurrent(starting);
    return false;
  }
  if (!response.ok) {
    throw { status: response.status, message: payload?.message || 'Session refresh is temporarily unavailable. Please try again.', errors: payload?.errors ?? null };
  }
  const auth = payload?.data;
  if (!auth?.token || auth.user?.userId !== starting.userId) {
    throw { status: 502, message: 'The server returned an invalid session response. Please try again.', errors: null };
  }
  side.save(auth);
  return true;
}

function expiresWithinMinute(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload));
    return Number.isFinite(claims.exp) && claims.exp * 1000 <= Date.now() + 60_000;
  } catch {
    return false;
  }
}

/** A hub's token: refreshed first when it runs out within a minute, on the side (game or admin) given. */
export async function freshAccessToken(scope = sessionScope()) {
  const current = authSnapshot(scope);
  if (current.token && expiresWithinMinute(current.token)) await refreshAfterUnauthorized(current);
  return sessionFor(scope).token();
}
