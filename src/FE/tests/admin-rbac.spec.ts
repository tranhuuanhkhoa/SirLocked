import { expect, test, type Page } from '@playwright/test';

async function signInAsRole(page: Page, permissions: string[], twoFactorEnabled = false) {
  await page.addInitScript(({ allowed, enabled }) => {
    localStorage.setItem('sirlocked.token', 'admin-rbac-fixture');
    localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'admin-rbac', fullName: 'RBAC Admin', email: 'admin@example.com', role: 'ADMIN',
      adminRole: 'SUPPORT', adminPermissions: allowed, twoFactorEnabled: enabled,
    }));
  }, { allowed: permissions, enabled: twoFactorEnabled });
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    json: { success: true, data: null },
  }));
}

test('role permissions filter admin tabs and show the forbidden panel', async ({ page }) => {
  await signInAsRole(page, ['content']);
  await page.goto('/admin/players');
  await expect(page.locator('.adm-forbidden')).toContainText('You do not have permission');
  await expect(page.locator('#admin-nav-root a[href="/admin/cases"]')).toBeVisible();
  await expect(page.locator('#admin-nav-root a[href="/admin/players"]')).toHaveCount(0);
  await expect(page.locator('#admin-nav-root a[href="/admin/security"]')).toBeVisible();
  await page.screenshot({ path: '/home/ubuntu/reports/admin-rbac/forbidden-access-panel.png', fullPage: true });
});

test('step-up modal authenticates once and retries the original request', async ({ page }) => {
  await signInAsRole(page, ['economy'], true);
  let operationCalls = 0;
  let stepUpBody: { password?: string; twoFactorCode?: string } | undefined;
  await page.route((url) => url.pathname === '/api/auth/admin/step-up', async (route) => {
    stepUpBody = route.request().postDataJSON();
    await route.fulfill({ json: { success: true, data: { stepUpUntil: '2099-01-01T00:00:00Z' } } });
  });
  await page.route((url) => url.pathname === '/api/test/step-up', async (route) => {
    operationCalls += 1;
    if (operationCalls === 1) {
      await route.fulfill({
        status: 403,
        json: { success: false, message: 'Re-authenticate.', errors: { code: 'STEP_UP_REQUIRED', messageKey: 'admin.stepUpRequired' } },
      });
      return;
    }
    await route.fulfill({ json: { success: true, data: { ok: true } } });
  });
  await page.goto('/admin/security');
  const result = page.evaluate(async () => {
    const { post } = await import('/Client/js/api/http.js');
    return post('/api/test/step-up', { amount: 1 });
  });
  const modal = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(modal).toBeVisible();
  await page.screenshot({ path: '/home/ubuntu/reports/admin-rbac/step-up-modal.png' });
  await modal.locator('[data-step-up-input]').fill('123456');
  await modal.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => operationCalls).toBe(2);
  await expect.poll(() => stepUpBody).toEqual({ twoFactorCode: '123456' });
  await expect(result).resolves.toEqual({ ok: true });
});

test('security page enables 2FA and displays a QR and one-time recovery codes', async ({ page }) => {
  await signInAsRole(page, [], false);
  await page.route((url) => url.pathname === '/api/auth/admin/2fa/setup', (route) => route.fulfill({
    json: {
      success: true,
      data: { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/SirLocked:admin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=SirLocked&digits=6&period=30' },
    },
  }));
  await page.route((url) => url.pathname === '/api/auth/admin/2fa/enable', (route) => route.fulfill({
    json: { success: true, data: { recoveryCodes: ['AAAA1111BB', 'CCCC2222DD'] } },
  }));
  await page.goto('/admin/security');
  await page.getByRole('button', { name: 'Set up 2FA' }).click();
  await expect(page.locator('.adm-security-qr')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await page.screenshot({ path: '/home/ubuntu/reports/admin-rbac/security-page-with-qr.png', fullPage: true });
  await page.locator('[data-security-enable-code]').fill('123456');
  await page.getByRole('button', { name: 'Enable 2FA' }).click();
  await expect(page.locator('[data-security-codes]')).toContainText('AAAA1111BB');
  await expect(page.locator('[data-security-codes]')).toContainText('CCCC2222DD');
});

test('player sign-in asks an admin for a code and routes the successful login to admin', async ({ page }) => {
  let loginAttempts = 0;
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ json: { success: true, data: null } }));
  await page.route((url) => url.pathname === '/api/auth/login', async (route) => {
    const request = route.request().postDataJSON();
    loginAttempts += 1;
    if (loginAttempts === 1) {
      await route.fulfill({
        status: 401,
        json: { success: false, message: 'Code required.', errors: { code: 'TWO_FACTOR_REQUIRED', messageKey: 'auth.twoFactorRequired' } },
      });
      return;
    }
    expect(request.twoFactorCode).toBe('123456');
    await route.fulfill({
      json: { success: true, data: { token: 'admin-token', user: { userId: 'admin', role: 'ADMIN', fullName: 'Admin', adminPermissions: [] } } },
    });
  });
  await page.goto('/login');
  await page.locator('#auth-login-email').fill('admin@example.com');
  await page.locator('#auth-login-password').fill('password123');
  await page.locator('#form-login button[type=submit]').click();
  await expect(page.locator('[data-two-factor-login]')).toBeVisible();
  await page.locator('[name=twoFactorCode]').fill('123456');
  await page.locator('#form-login button[type=submit]').click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect.poll(() => loginAttempts).toBe(2);
});
