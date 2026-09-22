import { get, post, patch } from './http.js';

export const authApi = {
  register: (fullName, email, password) => post('/api/auth/register', { fullName, email, password }),
  login: (email, password) => post('/api/auth/login', { email, password }),
  me: () => get('/api/auth/me'),
  changePassword: (currentPassword, newPassword) => patch('/api/auth/change-password', { currentPassword, newPassword }),
  refresh: (refreshToken) => post('/api/auth/refresh', { refreshToken }),
  forgotPassword: (email) => post('/api/auth/forgot-password', { email }),
  resetPassword: (token, newPassword) => post('/api/auth/reset-password', { token, newPassword }),
  verifyEmail: (token) => post('/api/auth/verify-email', { token }),
  resendVerification: () => post('/api/auth/resend-verification'),
  logout: () => post('/api/auth/logout'),
};
