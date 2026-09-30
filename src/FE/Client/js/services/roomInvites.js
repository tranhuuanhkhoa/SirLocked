const PENDING_INVITE_KEY = 'sirlocked.pendingInvite';
const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function normalizeRoomCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : '';
}

export function inviteCodeFromHash(hash = window.location.hash) {
  const [path, query = ''] = String(hash).split('?');
  if (path !== '#/join') return '';
  const values = new URLSearchParams(query).getAll('code');
  return values.length === 1 ? normalizeRoomCode(values[0]) : '';
}

export function inviteDestination(code) {
  const safeCode = normalizeRoomCode(code);
  return safeCode ? `#/join?code=${safeCode}` : '';
}

export function roomInviteUrl(code) {
  const destination = inviteDestination(code);
  if (!destination) return '';
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = destination;
  return url.href;
}

// Only a validated join code can survive authentication. Never store or follow
// arbitrary returnTo URLs, even if local storage was modified by an old client.
export function rememberRoomInvite(hash) {
  const destination = inviteDestination(inviteCodeFromHash(hash));
  if (!destination) return;
  try {
    localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ destination, expiresAt: Date.now() + INVITE_LIFETIME_MS }));
  } catch { /* The current invite URL still works when storage is unavailable. */ }
}

export function pendingRoomInvite() {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_INVITE_KEY) || 'null');
    const destination = inviteDestination(inviteCodeFromHash(typeof saved?.destination === 'string' ? saved.destination : ''));
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
  return `#/${room.status === 'IN_PROGRESS' ? 'game' : 'lobby'}/${encodeURIComponent(room.roomId)}`;
}
