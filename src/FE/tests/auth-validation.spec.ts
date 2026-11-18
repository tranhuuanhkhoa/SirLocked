import { expect, test } from '@playwright/test';

test('registration explains invalid input on the card before making a request', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/auth/register', (route) => { requests++; return route.abort(); });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.locator('#auth-reg-name').fill('A');
  await page.locator('#auth-reg-email').fill('invalid');
  await page.locator('#auth-reg-password').fill('abcdef');
  await page.locator('#form-register button[type=submit]').click();
  await expect(page.locator('#auth-reg-name-error')).toBeVisible();
  await expect(page.locator('#auth-reg-email-error')).toBeVisible();
  await expect(page.locator('#auth-reg-password-error')).toBeVisible();
  expect(requests).toBe(0);
});

test('registration puts API field errors beside their inputs', async ({ page }) => {
  await page.route('**/api/auth/register', (route) => route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ success: false, message: 'Check the form.', errors: {
      fullName: ['Please enter your full name.'], email: ['This email is already in use.'],
    } }),
  }));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.locator('#auth-reg-name').fill('Detective Holmes');
  await page.locator('#auth-reg-email').fill('detective@example.com');
  await page.locator('#auth-reg-password').fill('abc123');
  await page.locator('#form-register button[type=submit]').click();
  await expect(page.locator('#auth-reg-name-error')).toHaveText('Please enter your full name.');
  await expect(page.locator('#auth-reg-email-error')).toHaveText('This email is already in use.');
  await expect(page.locator('#auth-reg-email')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#auth-reg-email').fill('other@example.com');
  await expect(page.locator('#auth-reg-email-error')).toHaveCount(0);
  await expect(page.locator('#auth-reg-name-error')).toBeVisible();
});

for (const language of ['en', 'vi'] as const) {
  test(`duplicate email error follows ${language} UI language`, async ({ page }) => {
    await page.route('**/api/auth/register', (route) => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'Email này đã được đăng ký.', errors: {
        email: ['Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.'],
      } }),
    }));
    await page.goto('/login');
    await page.locator(`.auth-panel [data-ui-language="${language}"]`).click();
    await page.locator('[data-tab="register"]').click();
    await page.locator('#auth-reg-name').fill('Detective Holmes');
    await page.locator('#auth-reg-email').fill('detective@example.com');
    await page.locator('#auth-reg-password').fill('abc123');
    await page.locator('#form-register button[type=submit]').click();
    await expect(page.locator('#auth-reg-email-error')).toHaveText(language === 'en'
      ? 'This email is already registered. Sign in or use a different email.'
      : 'Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.');
  });

  test(`password reset delivery error follows ${language} UI language`, async ({ page }) => {
    await page.route('**/api/auth/forgot-password', (route) => route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'Password reset email delivery failed.' }),
    }));
    await page.goto('/login');
    await page.locator(`.auth-panel [data-ui-language="${language}"]`).click();
    await page.locator('#link-forgot').click();
    await page.locator('#auth-forgot-email').fill('detective@example.com');
    await page.locator('#form-forgot button[type=submit]').click();
    await expect(page.locator('#form-forgot .bpa-auth-form-error')).toHaveText(language === 'en'
      ? 'Password reset email delivery failed.'
      : 'Không gửi được email đặt lại mật khẩu. Vui lòng thử lại sau.');
  });
}

test('Google callback removes credentials from browser URL before fetching account', async ({ page }) => {
  let observedUrl = '';
  await page.route('**/api/auth/me', async (route) => {
    observedUrl = page.url();
    await route.fulfill({ status: 401, contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'Invalid test token.' }) });
  });
  // The server redirects to /oauth-callback#token=…; the page must strip it before any request.
  await page.goto('/oauth-callback#token=test-access&refreshToken=test-refresh');
  await expect.poll(() => observedUrl).not.toContain('test-access');
  expect(new URL(observedUrl).pathname).toBe('/oauth-callback');
  expect(observedUrl).not.toContain('test-refresh');
});

for (const language of ['en', 'vi'] as const) {
  test(`reset rejects the current password beside the field in ${language}`, async ({ page }) => {
    await page.route('**/api/auth/reset-password', (route) => route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'New password must be different from current password.', errors: {
        newPassword: ['New password must be different from current password.'],
      } }),
    }));
    await page.goto('/reset-password?token=test-reset-token');
    await page.locator(`.auth-panel [data-ui-language="${language}"]`).click();
    await page.locator('#reset-new').fill('old-password1');
    await page.locator('#reset-confirm').fill('old-password1');
    await page.locator('#form-reset button[type=submit]').click();
    await expect(page.locator('#reset-new-error')).toHaveText(language === 'en'
      ? 'New password must be different from current password.'
      : 'Mật khẩu mới phải khác mật khẩu hiện tại.');
  });
}
