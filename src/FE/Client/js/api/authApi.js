import { get, post, patch } from './http.js';

export const authApi = {
  register: (fullName, email, password) => post('/api/auth/register', { fullName, email, password }),
  login: (email, password, twoFactorCode) => post('/api/auth/login', { email, password, ...(twoFactorCode ? { twoFactorCode } : {}) }),
  adminLogin: (email, password, twoFactorCode) => post('/api/auth/admin/login', { email, password, ...(twoFactorCode ? { twoFactorCode } : {}) }),
  setupAdminTwoFactor: () => post('/api/auth/admin/2fa/setup'),
  enableAdminTwoFactor: (code) => post('/api/auth/admin/2fa/enable', { code }),
  disableAdminTwoFactor: (code) => post('/api/auth/admin/2fa/disable', { code }),
  adminStepUp: (body) => post('/api/auth/admin/step-up', body),
  me: () => get('/api/auth/me'),
  changePassword: (currentPassword, newPassword) => patch('/api/auth/change-password', { currentPassword, newPassword }),
  refresh: () => post('/api/auth/refresh', undefined, { headers: { 'X-SirLocked-Client': 'web' }, credentials: 'same-origin' }),
  forgotPassword: (email) => post('/api/auth/forgot-password', { email }),
  resetPassword: (token, newPassword) => post('/api/auth/reset-password', { token, newPassword }),
  verifyEmail: (token) => post('/api/auth/verify-email', { token }),
  resendVerification: () => post('/api/auth/resend-verification'),
  logout: () => post('/api/auth/logout', undefined, { credentials: 'same-origin' }),
};
