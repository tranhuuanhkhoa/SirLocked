import type { Page } from '@playwright/test';

/**
 * Signs in with a fake session and answers every API call with an empty success, for specs about admin pages.
 * An ADMIN is signed in on the admin side (sirlocked.admin.*), a VIP or PLAYER on the game side (sirlocked.*): the two
 * sides are separate sessions since the split (services/session.js).
 */
export async function signInAs(page: Page, role: 'ADMIN' | 'VIP' | 'PLAYER') {
  await page.addInitScript((userRole) => {
    const prefix = userRole === 'ADMIN' ? 'sirlocked.admin.' : 'sirlocked.';
    localStorage.setItem('sirlocked.sessionsSplit', '1');
    localStorage.setItem(`${prefix}token`, 'admin-test-token');
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem(`${prefix}user`, JSON.stringify({ userId: 'u1', fullName: 'Yến', role: userRole, isEmailVerified: true }));
  }, role);
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: null }),
  }));
}
