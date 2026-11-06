import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './helpers/adminSession';

/**
 * Two sign-in pages: /admin/login for admins, /login for everybody else. The server is the one that refuses a non-admin
 * (POST /api/auth/admin/login, covered in MongoAdminPlayersHostTests); these check what the site does around that answer.
 */
const adminAuth = {
  token: 'real-admin-token',
  refreshToken: 'real-admin-refresh',
  refreshTokenExpiry: '2099-01-01T00:00:00.000Z',
  user: { userId: 'a1', fullName: 'Quản trị', email: 'admin@example.com', role: 'ADMIN', isEmailVerified: true },
};
const playerAuth = {
  ...adminAuth,
  token: 'real-player-token',
  refreshToken: 'real-player-refresh',
  user: { userId: 'p1', fullName: 'Thám tử', email: 'player@example.com', role: 'PLAYER', isEmailVerified: true },
};

const address = (page: Page) => page.evaluate(() => `${location.pathname}${location.search}`);
const expectAddress = (page: Page, wanted: string) => expect.poll(() => address(page)).toBe(wanted);
const stored = (page: Page, key: string) => page.evaluate((name) => localStorage.getItem(name), key);

/** Answers every API call with an empty success and remembers the paths asked for. Routes added later win. */
async function fakeApi(page: Page) {
  const calls: string[] = [];
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    calls.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { success: true, data: null } });
  });
  return calls;
}

function answer(page: Page, path: string, status: number, body: object, onCall?: (request: unknown) => void) {
  return page.route((url) => url.pathname === path, (route) => {
    onCall?.(route.request().postDataJSON());
    return route.fulfill({ status, json: body });
  });
}

function refuse(page: Page, status: number) {
  return answer(page, '/api/auth/admin/login', status, { success: false, message: 'refused' });
}

async function vietnamese(page: Page) {
  await page.addInitScript(() => localStorage.setItem('sirlocked.uiLanguage', 'vi'));
}

async function submitAdminForm(page: Page, email = 'admin@example.com', password = 'Fixture-password1') {
  await page.locator('#form-admin-login [name="email"]').fill(email);
  await page.locator('#form-admin-login [name="password"]').fill(password);
  await page.locator('#form-admin-login button[type="submit"]').click();
}

async function submitUserForm(page: Page, email: string) {
  await page.locator('#form-login [name="email"]').fill(email);
  await page.locator('#form-login [name="password"]').fill('Fixture-password1');
  await page.locator('#form-login button[type="submit"]').click();
}

test.describe('which sign-in page a signed-out visitor gets', () => {
  for (const wanted of ['/admin', '/admin/players/u42', '/admin/chests']) {
    test(`${wanted} goes to the admin sign-in page`, async ({ page }) => {
      await fakeApi(page);
      await page.goto(wanted);
      await expectAddress(page, '/admin/login');
      await expect(page.locator('#form-admin-login')).toBeVisible();
    });
  }

  // /admin/ai is also open to VIP players, and they cannot use the admin page.
  for (const wanted of ['/cases', '/market', '/admin/ai']) {
    test(`${wanted} goes to the player sign-in page`, async ({ page }) => {
      await fakeApi(page);
      await page.goto(wanted);
      await expectAddress(page, '/login');
      await expect(page.locator('#form-login')).toBeVisible();
    });
  }
});

test.describe('what each page offers', () => {
  test('the admin page has no registration, no Google and no site menu', async ({ page }) => {
    await vietnamese(page);
    await fakeApi(page);
    await page.goto('/admin/login');
    await expect(page.getByRole('heading', { name: 'Đăng nhập quản trị' })).toBeVisible();
    await expect(page.locator('#form-admin-login [name="email"]')).toBeVisible();
    await expect(page.locator('#form-admin-login [name="password"]')).toBeVisible();
    await expect(page.locator('#form-register')).toHaveCount(0);
    await expect(page.locator('.bpa-auth-google')).toHaveCount(0);
    await expect(page.locator('.admin-nav-tab')).toHaveCount(0);
    await expect(page.locator('a.bpa-shell-link')).toHaveCount(0);
  });

  test('the admin page sends a lost player to their own page', async ({ page }) => {
    await vietnamese(page);
    await fakeApi(page);
    await page.goto('/admin/login');
    await page.getByRole('link', { name: 'Về trang đăng nhập người chơi' }).click();
    await expectAddress(page, '/login');
    await expect(page.locator('#form-login')).toBeVisible();
  });

  test('the player page keeps registration and Google, and does not advertise the admin page', async ({ page }) => {
    await fakeApi(page);
    await page.goto('/login');
    await expect(page.locator('#form-login')).toBeVisible();
    await expect(page.locator('.bpa-auth-google')).toBeVisible();
    await expect(page.locator('.bpa-auth-tab[data-tab="register"]')).toBeVisible();
    await expect(page.locator('a[href="/admin/login"]')).toHaveCount(0);
  });

  test('the admin page reads in English too', async ({ page }) => {
    await fakeApi(page);
    await page.goto('/admin/login');
    await page.locator('.adm-login [data-ui-language="en"]').click();
    await expect(page.getByRole('heading', { name: 'Admin sign-in' })).toBeVisible();
    await page.locator('.adm-login [data-ui-language="vi"]').click();
    await expect(page.getByRole('heading', { name: 'Đăng nhập quản trị' })).toBeVisible();
  });

  test('the admin page fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fakeApi(page);
    await page.goto('/admin/login');
    await expect(page.locator('#form-admin-login')).toBeVisible();
    await expect(page.locator('.bpa-rim')).toHaveCount(0); // The route's lens overflows for a moment on every page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});

test.describe('signing in on the admin page', () => {
  test('an admin lands on the dashboard, through the admin route only', async ({ page }) => {
    await vietnamese(page);
    const calls = await fakeApi(page);
    let sent: unknown;
    await answer(page, '/api/auth/admin/login', 200, { success: true, data: adminAuth }, (body) => { sent = body; });
    await page.goto('/admin/login');
    await submitAdminForm(page);
    await expectAddress(page, '/admin');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Tổng quan');
    expect(sent).toEqual({ email: 'admin@example.com', password: 'Fixture-password1' });
    expect(calls).not.toContain('/api/auth/login');
    expect(await stored(page, 'sirlocked.token')).toBe('real-admin-token');
  });

  test('a refused account stays on the page, is told why, and nothing is stored', async ({ page }) => {
    await vietnamese(page);
    await fakeApi(page);
    await refuse(page, 403);
    await page.goto('/admin/login');
    await submitAdminForm(page, 'player@example.com');
    await expect(page.getByRole('alert')).toContainText('không có quyền admin');
    await expectAddress(page, '/admin/login');
    expect(await stored(page, 'sirlocked.token')).toBeNull();
    expect(await stored(page, 'sirlocked.user')).toBeNull();
  });

  test('a wrong password says so', async ({ page }) => {
    await vietnamese(page);
    await fakeApi(page);
    await refuse(page, 401);
    await page.goto('/admin/login');
    await submitAdminForm(page);
    await expect(page.getByRole('alert')).toContainText('Sai email hoặc mật khẩu');
  });

  test('too many tries says to wait', async ({ page }) => {
    await vietnamese(page);
    await fakeApi(page);
    await refuse(page, 429);
    await page.goto('/admin/login');
    await submitAdminForm(page);
    await expect(page.getByRole('alert')).toContainText('Đợi 1 phút');
  });

  test('a second try clears the first error', async ({ page }) => {
    await vietnamese(page);
    await fakeApi(page);
    await refuse(page, 401);
    await page.goto('/admin/login');
    await submitAdminForm(page);
    await expect(page.getByRole('alert')).toContainText('Sai email hoặc mật khẩu');
    await refuse(page, 403);
    await submitAdminForm(page);
    await expect(page.getByRole('alert')).toContainText('không có quyền admin');
    await expect(page.getByRole('alert')).toHaveCount(1);
  });

  test('a failed try does not stop the next one from working', async ({ page }) => {
    await vietnamese(page);
    await fakeApi(page);
    await refuse(page, 401);
    await page.goto('/admin/login');
    await submitAdminForm(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await answer(page, '/api/auth/admin/login', 200, { success: true, data: adminAuth });
    await submitAdminForm(page);
    await expectAddress(page, '/admin');
  });

  test('the button works again after a refusal', async ({ page }) => {
    await fakeApi(page);
    await refuse(page, 403);
    await page.goto('/admin/login');
    await submitAdminForm(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('#form-admin-login button[type="submit"]')).toBeEnabled();
  });
});

test.describe('arriving already signed in', () => {
  test('an admin goes straight to the dashboard', async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await page.goto('/admin/login');
    await expectAddress(page, '/admin');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Tổng quan');
  });

  test('a player sees the form instead of being sent away', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/admin/login');
    await expect(page.locator('#form-admin-login')).toBeVisible();
    await expect(page.locator('.bpa-auth-note')).toContainText('Yến');
    await expectAddress(page, '/admin/login');
  });

  test('a player who signs in as an admin swaps to that session', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await answer(page, '/api/auth/admin/login', 200, { success: true, data: adminAuth });
    await page.goto('/admin/login');
    await submitAdminForm(page);
    await expectAddress(page, '/admin');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Tổng quan');
    expect(await stored(page, 'sirlocked.token')).toBe('real-admin-token');
    expect(await stored(page, 'sirlocked.refreshToken')).toBe('real-admin-refresh');
  });

  test('a wrong password does not end the session the player already has', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    const calls: string[] = [];
    page.on('request', (request) => calls.push(new URL(request.url()).pathname));
    await refuse(page, 401);
    await page.goto('/admin/login');
    await submitAdminForm(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await expectAddress(page, '/admin/login');
    expect(await stored(page, 'sirlocked.token')).toBe('admin-test-token');
    expect(calls).not.toContain('/api/auth/refresh');
  });

  test('a refused account does not end the session the player already has', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await refuse(page, 403);
    await page.goto('/admin/login');
    await submitAdminForm(page);
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await stored(page, 'sirlocked.token')).toBe('admin-test-token');
  });

  test('a player opening an admin page is still sent to the cases', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/admin');
    await expectAddress(page, '/cases');
  });
});

test.describe('signing in on the player page', () => {
  test('a player lands on the menu', async ({ page }) => {
    await fakeApi(page);
    await answer(page, '/api/auth/login', 200, { success: true, data: playerAuth });
    await page.goto('/login');
    await submitUserForm(page, 'player@example.com');
    await expectAddress(page, '/menu');
  });

  test('an admin also lands on the menu, and the admin pages still open for them', async ({ page }) => {
    await vietnamese(page);
    await fakeApi(page);
    await answer(page, '/api/auth/login', 200, { success: true, data: adminAuth });
    await page.goto('/login');
    await submitUserForm(page, 'admin@example.com');
    await expectAddress(page, '/menu');
    await page.goto('/admin');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Tổng quan');
  });

  test('an admin arriving from Google lands on the menu, and the admin pages still open for them', async ({ page }) => {
    await vietnamese(page);
    await fakeApi(page);
    await answer(page, '/api/auth/me', 200, { success: true, data: adminAuth.user });
    await page.goto('/oauth-callback#token=google-token&refreshToken=google-refresh');
    await expectAddress(page, '/menu');
    await page.goto('/admin');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Tổng quan');
  });
});

test.describe('leaving', () => {
  test('an admin signing out from the site menu returns to the admin page', async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await page.goto('/admin');
    await page.locator('#nav-logout').click();
    await expectAddress(page, '/admin/login');
    expect(await stored(page, 'sirlocked.token')).toBeNull();
  });

  test('a player signing out from the site menu returns to the player page', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/cases');
    await page.locator('#nav-logout').click();
    await expectAddress(page, '/login');
  });

  test('an admin signing out from the title menu returns to the admin page', async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await page.goto('/menu');
    await page.locator('#title-menu-logout').click();
    await expectAddress(page, '/admin/login');
  });

  test('a player signing out from the title menu returns to the player page', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/menu');
    await page.locator('#title-menu-logout').click();
    await expectAddress(page, '/login');
  });

  test('an admin whose session ran out returns to the admin page', async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
      status: 401, json: { success: false, message: 'expired' },
    }));
    await page.goto('/admin');
    await expectAddress(page, '/admin/login');
    expect(await stored(page, 'sirlocked.token')).toBeNull();
  });

  test('a player whose session ran out returns to the player page', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
      status: 401, json: { success: false, message: 'expired' },
    }));
    await page.goto('/cases');
    await expectAddress(page, '/login');
  });
});
