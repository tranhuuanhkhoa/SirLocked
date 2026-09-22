import { session } from '../services/session.js';
import { authApi } from '../api/authApi.js';
import { render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderOAuthCallbackPage(app) {
  render(app, '<div class="page" style="text-align:center;padding:60px"><p>Đang xử lý đăng nhập Google...</p></div>');

  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const token = params.get('token');
  const refreshToken = params.get('refreshToken');
  const error = params.get('error');

  if (error || !token) {
    toast('Đăng nhập Google thất bại. Vui lòng thử lại.', 'error');
    window.location.hash = '#/login';
    return;
  }

  try {
    // Lưu token tạm để gọi /me
    localStorage.setItem('sirlocked.token', token);
    if (refreshToken) localStorage.setItem('sirlocked.refreshToken', refreshToken);

    const user = await authApi.me();
    session.save({ token, refreshToken, refreshTokenExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), user });

    toast(`Chào mừng, ${user.fullName}!`, 'success');
    window.location.hash = user.role === 'ADMIN' ? '#/admin' : '#/menu';
  } catch {
    session.clear();
    toast('Đăng nhập Google thất bại.', 'error');
    window.location.hash = '#/login';
  }
}
