import { expect, test, type Page } from '@playwright/test';

async function signInAsRole(page: Page, permissions: string[], twoFactorEnabled = false, language: 'en' | 'vi' = 'en') {
  await page.addInitScript(({ allowed, enabled, language }) => {
    localStorage.setItem('sirlocked.token', 'admin-rbac-fixture');
    localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'admin-rbac', fullName: 'RBAC Admin', email: 'admin@example.com', role: 'ADMIN',
      adminRole: 'SUPPORT', adminPermissions: allowed, twoFactorEnabled: enabled,
    }));
    localStorage.setItem('sirlocked.uiLanguage', language);
  }, { allowed: permissions, enabled: twoFactorEnabled, language });
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    json: { success: true, data: null },
  }));
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('role permissions filter admin tabs and show the forbidden panel', async ({ page }, testInfo) => {
  await signInAsRole(page, ['content']);
  await page.goto('/admin/players');
  await expect(page.locator('#app .adm-forbidden h1')).toHaveText('Access restricted');
  await expect(page.locator('#app .adm-forbidden')).toContainText('You do not have permission');
  await expect(page.locator('#admin-nav-root')).toBeVisible();
  await expect(page.locator('#nav-root')).toBeVisible();
  await expect(page.locator('#bpa-loading')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/game-page-active/);
  await expect(page.locator('#admin-nav-root a[href="/admin/cases"]')).toBeVisible();
  await expect(page.locator('#admin-nav-root a[href="/admin/players"]')).toHaveCount(0);
  await expect(page.locator('#admin-nav-root a[href="/admin/security"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('forbidden-access-panel.png'), fullPage: true });
});

test('step-up modal authenticates once and retries the original request', async ({ page }, testInfo) => {
  await signInAsRole(page, ['economy'], true);
  let operationCalls = 0;
  let stepUpAttempts = 0;
  let stepUpBody: { password?: string; twoFactorCode?: string } | undefined;
  await page.route((url) => url.pathname === '/api/auth/admin/step-up', async (route) => {
    stepUpAttempts += 1;
    stepUpBody = route.request().postDataJSON();
    if (stepUpAttempts === 1) {
      await route.fulfill({
        status: 401,
        json: { success: false, message: 'The two-factor code is invalid.', errors: { code: 'TWO_FACTOR_INVALID' } },
      });
      return;
    }
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
  await expect(modal.locator('[data-step-up-input]')).toBeFocused();
  await expect(modal).toHaveCSS('background-color', 'rgb(255, 253, 249)');
  await expect(modal.locator('[data-step-up-confirm]')).toHaveCSS('background-color', 'rgb(16, 32, 58)');
  await expect(modal.locator('[data-step-up-confirm]')).toHaveCSS('font-family', /Be Vietnam Pro/);
  await expect(page.locator('.adm-step-up-overlay')).toHaveCSS('z-index', '20000');
  await page.screenshot({ path: testInfo.outputPath('step-up-modal.png') });
  await modal.locator('[data-step-up-input]').fill('000000');
  await modal.locator('[data-step-up-confirm]').click();
  await expect(modal.locator('[data-step-up-error]')).toBeVisible();
  await expect(modal.locator('[data-step-up-error]')).toContainText('The two-factor code is invalid.');
  await modal.locator('[data-step-up-input]').fill('123456');
  await modal.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => operationCalls).toBe(2);
  await expect.poll(() => stepUpAttempts).toBe(2);
  await expect.poll(() => stepUpBody).toEqual({ twoFactorCode: '123456' });
  await expect(result).resolves.toEqual({ ok: true });
});

test('step-up modal is localized and can be closed with Escape or Cancel', async ({ page }, testInfo) => {
  await signInAsRole(page, ['economy'], true, 'vi');
  await page.route((url) => url.pathname === '/api/test/step-up-dismiss', (route) => route.fulfill({
    status: 403,
    json: { success: false, message: 'Re-authenticate.', errors: { code: 'STEP_UP_REQUIRED', messageKey: 'admin.stepUpRequired' } },
  }));
  await page.goto('/admin/security');
  const requestStepUp = () => page.evaluate(async () => {
    const { post } = await import('/Client/js/api/http.js');
    try {
      await post('/api/test/step-up-dismiss', {});
      return 'resolved';
    } catch {
      return 'cancelled';
    }
  });
  const first = requestStepUp();
  const modal = page.getByRole('dialog', { name: 'Xác nhận danh tính' });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Tiếp tục' })).toBeVisible();
  await expect(modal.locator('[data-step-up-input]')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('step-up-modal-vi.png') });
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(first).resolves.toBe('cancelled');

  const second = requestStepUp();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Hủy' }).click();
  await expect(modal).toBeHidden();
  await expect(second).resolves.toBe('cancelled');
});

test('security page enables 2FA and displays a QR and one-time recovery codes', async ({ page }, testInfo) => {
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
  await page.screenshot({ path: testInfo.outputPath('security-page-with-qr.png'), fullPage: true });
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
