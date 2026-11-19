/**
 * Two sessions live side by side in one browser: the game's ('player', the sirlocked.* keys it always used) and the admin
 * pages' ('admin', sirlocked.admin.*). Signing in, out or running out on one side leaves the other as it was. Which one a
 * page uses follows its address (sessionScope), so `session` below always answers for the page on screen.
 */
const KEYS = {
  player: { token: 'sirlocked.token', user: 'sirlocked.user', refreshToken: 'sirlocked.refreshToken', expiry: 'sirlocked.refreshExpiry' },
  admin: {
    token: 'sirlocked.admin.token', user: 'sirlocked.admin.user', refreshToken: 'sirlocked.admin.refreshToken', expiry: 'sirlocked.admin.refreshExpiry',
  },
};
// Set once this browser's old shared session has been sorted into the two sides.
const SPLIT_MARK = 'sirlocked.sessionsSplit';
// Per tab: the rooms this tab opened for a playtest from the admin pages, so it plays them as the admin.
const ADMIN_ROOMS = 'sirlocked.adminRooms';
const ADMIN_ROOMS_KEPT = 20;

const ADMIN_AREA = /^\/admin(?:\/|$)/;
// The AI order page is shared with VIP players, who have no admin session.
const AI_ORDERS = /^\/admin\/ai\/?$/;
const ROOM_PAGE = /^\/(?:lobby|game|result)\/([^/]+)\/?$/;

let splitChecked = false;

function readUser(keys) {
  try {
    return JSON.parse(localStorage.getItem(keys.user) || 'null');
  } catch {
    return null;
  }
}

/**
 * Until this change one session served both sides. An admin account found there moves to the admin side, once: an admin
 * stays signed in on the admin pages and the game starts signed out. After that an admin account signed in on the game
 * side on purpose stays there.
 */
function splitSharedSessionOnce() {
  if (splitChecked) return;
  splitChecked = true;
  try {
    if (localStorage.getItem(SPLIT_MARK)) return;
    localStorage.setItem(SPLIT_MARK, '1');
    if (readUser(KEYS.player)?.role !== 'ADMIN' || localStorage.getItem(KEYS.admin.token)) return;
    for (const field of Object.keys(KEYS.player)) {
      const value = localStorage.getItem(KEYS.player[field]);
      if (value !== null) localStorage.setItem(KEYS.admin[field], value);
      localStorage.removeItem(KEYS.player[field]);
    }
  } catch {
    /* Storage that cannot be read has no session to sort. */
  }
}

function adminRooms() {
  try {
    const rooms = JSON.parse(sessionStorage.getItem(ADMIN_ROOMS) || '[]');
    return Array.isArray(rooms) ? rooms : [];
  } catch {
    return [];
  }
}

/** 'admin' or 'player': the session a page at `pathname` uses. */
export function sessionScope(pathname = window.location.pathname) {
  splitSharedSessionOnce();
  if (ADMIN_AREA.test(pathname)) {
    // A VIP orders with their game account; an admin session, when there is one, takes the page. An admin account
    // signed in on the game side does not count: the admin pages always go through /admin/login.
    if (AI_ORDERS.test(pathname) && !localStorage.getItem(KEYS.admin.token) && readUser(KEYS.player)?.role !== 'ADMIN') return 'player';
    return 'admin';
  }
  const room = pathname.match(ROOM_PAGE)?.[1];
  if (room && adminRooms().includes(decodeURIComponent(room))) return 'admin';
  return 'player';
}

/**
 * Called by an admin page that opens a playtest room: this tab then plays the room (lobby, game, result) as the admin,
 * while another tab, or the invited player, comes in with their own game account. Does nothing outside the admin side.
 */
export function rememberAdminRoom(roomId) {
  if (!roomId || sessionScope() !== 'admin') return;
  try {
    const rooms = [String(roomId), ...adminRooms().filter((room) => room !== String(roomId))].slice(0, ADMIN_ROOMS_KEPT);
    sessionStorage.setItem(ADMIN_ROOMS, JSON.stringify(rooms));
  } catch {
    /* Without storage the room is played with the game account. */
  }
}

/** The session of one side, whatever page is on screen. */
export function sessionFor(scope) {
  splitSharedSessionOnce();
  const keys = scope === 'admin' ? KEYS.admin : KEYS.player;
  return {
    scope: scope === 'admin' ? 'admin' : 'player',
    save(auth) {
      localStorage.setItem(keys.token, auth.token);
      localStorage.setItem(keys.user, JSON.stringify(auth.user));
      if (auth.refreshToken) {
        localStorage.setItem(keys.refreshToken, auth.refreshToken);
        localStorage.setItem(keys.expiry, auth.refreshTokenExpiry);
      }
    },
    clear() {
      for (const key of Object.values(keys)) localStorage.removeItem(key);
    },
    token() {
      return localStorage.getItem(keys.token) || '';
    },
    refreshToken() {
      return localStorage.getItem(keys.refreshToken) || '';
    },
    isRefreshTokenValid() {
      const expiry = localStorage.getItem(keys.expiry);
      if (!expiry) return false;
      return new Date(expiry) > new Date();
    },
    user() {
      return readUser(keys);
    },
    isLoggedIn() {
      return Boolean(this.token());
    },
    isAdmin() {
      return this.user()?.role === 'ADMIN';
    },
    /** The page this side signs in on. Read it before clear(). */
    loginAddress() {
      return this.scope === 'admin' ? '/admin/login' : '/login';
    },
    /** Where this side starts: the admin dashboard, or the game's menu. */
    home() {
      return this.scope === 'admin' && this.isAdmin() ? '/admin' : '/menu';
    },
    isEmailVerified() {
      const user = this.user();
      if (!user) return false;
      // Admin được miễn xác minh
      return user.role === 'ADMIN' || user.isEmailVerified === true;
    },
    setEmailVerified() {
      const user = this.user();
      if (!user) return;
      user.isEmailVerified = true;
      localStorage.setItem(keys.user, JSON.stringify(user));
    },
    isVip() {
      return this.user()?.role === 'VIP';
    },
    canGenerateAi() {
      const role = this.user()?.role;
      return role === 'ADMIN' || role === 'VIP';
    },
  };
}

const current = () => sessionFor(sessionScope());

/** The session of the page on screen. */
export const session = {
  save: (auth) => current().save(auth),
  clear: () => current().clear(),
  token: () => current().token(),
  refreshToken: () => current().refreshToken(),
  isRefreshTokenValid: () => current().isRefreshTokenValid(),
  user: () => current().user(),
  isLoggedIn: () => current().isLoggedIn(),
  isAdmin: () => current().isAdmin(),
  loginAddress: () => current().loginAddress(),
  home: () => current().home(),
  isEmailVerified: () => current().isEmailVerified(),
  setEmailVerified: () => current().setEmailVerified(),
  isVip: () => current().isVip(),
  canGenerateAi: () => current().canGenerateAi(),
};
