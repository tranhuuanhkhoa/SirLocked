import type { Page } from '@playwright/test';

/** Signs in with a fake session and answers every API call with an empty success, for specs about admin pages. */
export async function signInAs(page: Page, role: 'ADMIN' | 'VIP' | 'PLAYER') {
  await page.addInitScript((userRole) => {
    localStorage.setItem('sirlocked.token', 'admin-test-token');
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'u1', fullName: 'Yến', role: userRole, isEmailVerified: true }));
  }, role);
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: null }),
  }));
}
