const PENDING_INVITE_KEY = 'sirlocked.pendingInvite';
const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function normalizeRoomCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : '';
}

/** The secret of a playtest invite (`&invite=…`): URL-safe characters only, or '' when it is anything else. */
export function normalizeInviteToken(value) {
  const token = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : '';
}

function joinQuery(address) {
  // An invite saved before addresses were plain paths starts with #.
  const [path, query = ''] = String(address).replace(/^#/, '').split('?');
  return path === '/join' ? new URLSearchParams(query) : null;
}

export function inviteCodeFromRoute(address = `${window.location.pathname}${window.location.search}`) {
  const values = joinQuery(address)?.getAll('code') ?? [];
  return values.length === 1 ? normalizeRoomCode(values[0]) : '';
}

/** The playtest invite secret of a /join address, or '' (ordinary invites have none). */
export function inviteTokenFromRoute(address = `${window.location.pathname}${window.location.search}`) {
  const values = joinQuery(address)?.getAll('invite') ?? [];
  return values.length === 1 ? normalizeInviteToken(values[0]) : '';
}

export function inviteDestination(code, token = '') {
  const safeCode = normalizeRoomCode(code);
  const safeToken = normalizeInviteToken(token);
  return safeCode ? `/join?code=${safeCode}${safeToken ? `&invite=${safeToken}` : ''}` : '';
}

export function roomInviteUrl(code, token = '') {
  const destination = inviteDestination(code, token);
  if (!destination) return '';
  return new URL(destination, window.location.origin).href;
}

// Only a validated join code (and playtest secret) can survive authentication. Never store or follow
// arbitrary returnTo URLs, even if local storage was modified by an old client.
export function rememberRoomInvite(address) {
  const destination = inviteDestination(inviteCodeFromRoute(address), inviteTokenFromRoute(address));
  if (!destination) return;
  try {
    localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ destination, expiresAt: Date.now() + INVITE_LIFETIME_MS }));
  } catch { /* The current invite URL still works when storage is unavailable. */ }
}

export function pendingRoomInvite() {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_INVITE_KEY) || 'null');
    const savedDestination = typeof saved?.destination === 'string' ? saved.destination : '';
    const destination = inviteDestination(inviteCodeFromRoute(savedDestination), inviteTokenFromRoute(savedDestination));
    if (destination && Number.isFinite(saved?.expiresAt) && saved.expiresAt > Date.now()) return destination;
    clearRoomInvite();
  } catch { clearRoomInvite(); }
  return '';
}

export function clearRoomInvite() {
  try { localStorage.removeItem(PENDING_INVITE_KEY); } catch { /* Optional convenience only. */ }
}

export function activeRoomDestination(room) {
  if (!room?.roomId || !['WAITING', 'READY', 'IN_PROGRESS'].includes(room.status)) return '';
  return `/${room.status === 'IN_PROGRESS' ? 'game' : 'lobby'}/${encodeURIComponent(room.roomId)}`;
}
