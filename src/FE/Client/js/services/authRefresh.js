import { session } from './session.js';

const REFRESH_LOCK = 'sirlocked.auth-refresh';
const pendingRefreshes = new Map();

export function authSnapshot() {
  return { token: session.token(), refreshToken: session.refreshToken(), userId: session.user()?.userId || '' };
}

function sameSession(left, right) {
  return left.token === right.token && left.refreshToken === right.refreshToken && left.userId === right.userId;
}

export function canRetryForAccount(original) {
  const current = authSnapshot();
  return Boolean(original.userId && current.token && current.userId === original.userId);
}

function hasNewerSession(original) {
  const current = authSnapshot();
  return Boolean(original.userId && current.token && current.userId === original.userId && current.token !== original.token);
}

export function expireSessionIfCurrent(original) {
  if (!original.token || !sameSession(original, authSnapshot())) return;
  session.clear();
  window.location.hash = '#/login';
}

export function isPublicAuthRequest(path) {
  const pathname = String(path).split('?')[0];
  return /^\/api\/auth\/(login|register|refresh|forgot-password|reset-password|verify-email|google(?:\/callback)?)\/?$/.test(pathname);
}

export function refreshAfterUnauthorized(original) {
  const key = JSON.stringify(original);
  if (pendingRefreshes.has(key)) return pendingRefreshes.get(key);

  const pending = (async () => {
    try {
      // The lock spans tabs on this origin. Re-read storage after acquiring it:
      // another tab may already have rotated the one-use refresh token.
      if (navigator.locks?.request) {
        return await navigator.locks.request(REFRESH_LOCK, () => refreshCurrentSession(original));
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

async function refreshCurrentSession(original) {
  if (!canRetryForAccount(original)) return false;
  if (hasNewerSession(original)) return true;
  const starting = authSnapshot();
  if (!starting.refreshToken || !session.isRefreshTokenValid()) {
    expireSessionIfCurrent(starting);
    return false;
  }

  let response;
  try {
    response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: starting.refreshToken }),
    });
  } catch {
    if (!sameSession(starting, authSnapshot())) return hasNewerSession(original);
    // A lost connection is not proof that the shared session was revoked.
    throw { status: 0, message: 'Cannot reach the server. Please try again.', errors: null };
  }

  let payload = null;
  try { payload = await response.json(); } catch { /* A proxy may return a non-JSON failure. */ }

  // Logout, another login or a refresh fallback may change storage while HTTP is pending.
  // An old response must never restore a logged-out account or overwrite the new one.
  if (!sameSession(starting, authSnapshot())) return hasNewerSession(original);
  if (response.status === 401 || response.status === 403) {
    expireSessionIfCurrent(starting);
    return false;
  }
  if (!response.ok) {
    throw { status: response.status, message: payload?.message || 'Session refresh is temporarily unavailable. Please try again.', errors: payload?.errors ?? null };
  }
  const auth = payload?.data;
  if (!auth?.token || !auth.refreshToken || auth.user?.userId !== starting.userId) {
    throw { status: 502, message: 'The server returned an invalid session response. Please try again.', errors: null };
  }
  session.save(auth);
  return true;
}
