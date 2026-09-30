import { expect, test } from '@playwright/test';

test('Google sign-in from the numeric frontend host starts directly on the configured API host', async ({ page }) => {
  const apiLogin = new URL('/api/auth/google', process.env.VITE_API_URL || 'http://localhost:5215').href;
  // Fulfill the initial API navigation locally: this test never contacts Google.
  await page.route(apiLogin, (route) => route.fulfill({
    contentType: 'text/html', body: '<p>Canonical API sign-in entry reached</p>',
  }));
  await page.goto('/#/login');
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
  const google = page.getByRole('link', { name: 'Continue with Google' });
  await expect(google).toHaveAttribute('href', apiLogin);
  await google.click();
  await expect(page).toHaveURL(apiLogin);
  await expect(page.getByText('Canonical API sign-in entry reached')).toBeVisible();
});

for (const code of ['google_failed', 'google_cancelled']) {
  test(`the ${code} callback remains on login and explains how to retry in both languages`, async ({ page }) => {
    await page.goto(`/#/login?error=${code}`);
    await expect(page).toHaveURL(new RegExp(`#/login\\?error=${code}$`));
    await expect(page.getByRole('alert')).toContainText(code === 'google_cancelled'
      ? 'Google sign-in was cancelled' : 'Google sign-in could not be completed');
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.locator('#form-login')).toBeVisible();
    await page.locator('.auth-panel [data-ui-language="vi"]').click();
    await expect(page.getByRole('alert')).toContainText(code === 'google_cancelled'
      ? 'Đăng nhập Google đã bị hủy' : 'Không thể hoàn tất đăng nhập Google');
    await expect(page.getByRole('link', { name: 'Đăng nhập với Google' })).toBeVisible();
  });
}

test('an OAuth failure is visible with an existing session and keeps the pending room invitation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'old-session-fixture');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'fixture', fullName: 'Detective', role: 'PLAYER' }));
    localStorage.setItem('sirlocked.pendingInvite', JSON.stringify({
      destination: '#/join?code=ABC123', expiresAt: Date.now() + 60_000,
    }));
  });
  await page.goto('/#/login?error=google_failed');
  await expect(page.getByRole('alert')).toContainText('Google sign-in could not be completed');
  await expect(page.locator('.auth-hint')).toContainText('Your invitation is saved');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sirlocked.pendingInvite') || 'null').destination))
    .toBe('#/join?code=ABC123');
});

test('Google entry configuration keeps production same-origin and respects development API overrides', async ({ page }) => {
  await page.goto('/#/login');
  const urls = await page.evaluate(async () => {
    const modulePath = '/config/apiUrls.js';
    const { googleLoginUrl } = await import(modulePath);
    return {
      production: googleLoginUrl(false, 'http://localhost:5216'),
      overriddenDevelopment: googleLoginUrl(true, 'http://127.0.0.1:5216'),
      defaultDevelopment: googleLoginUrl(true),
    };
  });
  expect(urls).toEqual({ production: '/api/auth/google',
    overriddenDevelopment: 'http://127.0.0.1:5216/api/auth/google',
    defaultDevelopment: 'http://localhost:5215/api/auth/google' });
});
