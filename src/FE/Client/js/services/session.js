const TOKEN_KEY = 'sirlocked.token';
const USER_KEY = 'sirlocked.user';

export const session = {
  save(auth) {
    localStorage.setItem(TOKEN_KEY, auth.token);
    localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  token() {
    return localStorage.getItem(TOKEN_KEY) || '';
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
};
