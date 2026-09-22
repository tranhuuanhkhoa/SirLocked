const TOKEN_KEY = 'sirlocked.token';
const USER_KEY = 'sirlocked.user';
const REFRESH_TOKEN_KEY = 'sirlocked.refreshToken';
const REFRESH_EXPIRY_KEY = 'sirlocked.refreshExpiry';

export const session = {
  save(auth) {
    localStorage.setItem(TOKEN_KEY, auth.token);
    localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
    if (auth.refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, auth.refreshToken);
      localStorage.setItem(REFRESH_EXPIRY_KEY, auth.refreshTokenExpiry);
    }
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(REFRESH_EXPIRY_KEY);
  },
  token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  },
  refreshToken() {
    return localStorage.getItem(REFRESH_TOKEN_KEY) || '';
  },
  isRefreshTokenValid() {
    const expiry = localStorage.getItem(REFRESH_EXPIRY_KEY);
    if (!expiry) return false;
    return new Date(expiry) > new Date();
  },
  user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  isLoggedIn() {
    return Boolean(this.token());
  },
  isAdmin() {
    return this.user()?.role === 'ADMIN';
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
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  isVip() {
    return this.user()?.role === 'VIP';
  },
  canGenerateAi() {
    const role = this.user()?.role;
    return role === 'ADMIN' || role === 'VIP';
  },
};
