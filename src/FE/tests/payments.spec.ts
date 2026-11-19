import { expect, test, type Page } from '@playwright/test';

const CODE = 1234567890123456;
const order = (status = 'PENDING') => ({
  orderCode: CODE, amount: 10000, coins: 1000, status,
  checkoutUrl: 'https://pay.payos.vn/web/124c33293c934a85be5b7f8761a27a07',
  qrCode: '00020101021238570010A000000727012700069704220113113366668888020899998888530370454061000005802VN62230819THANH TOAN DON HANG6304BE36',
  accountNumber: '123456789', accountName: 'SIRLOCKED DEMO', bankBin: '970422', description: 'SLNAPXU',
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900000).toISOString(), creditedAt: null,
});
async function setup(page: Page, enabled = true) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'test-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'player-1', fullName: 'Thám tử', role: 'PLAYER', isEmailVerified: true }));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    (window as any).__sirlockedNoSignalR = true;
  });
  const state = { current: order(), creates: [] as any[], requests: 0, cancels: 0, failFirst: false };
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname;
    let data: any = null;
    if (path === '/api/market/me') data = { balance: state.current.status === 'CREDITED' ? 1500 : 500, held: 0 };
    if (path === '/api/profile/me') data = { rank: { tier: 'APPRENTICE' }, isEmailVerified: true };
    if (path === '/api/payments/packages') data = { enabled, packages: [{ id: 'starter', amount: 10000, coins: 1000 }, { id: 'detective', amount: 50000, coins: 5000 }] };
    if (path === '/api/payments/orders') {
      if (route.request().method() === 'POST') {
        state.creates.push(route.request().postDataJSON());
        if (state.failFirst && state.creates.length === 1) { await route.abort(); return; }
        data = state.current;
      } else data = [];
    }
    if (path === `/api/payments/orders/${CODE}`) { state.requests++; data = state.current; }
    if (path.endsWith('/cancel')) { state.cancels++; state.current = order('CANCELLED'); data = state.current; }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  return state;
}

test('packages create a server-priced order and render a local QR', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/payments');
  await page.getByRole('button', { name: 'Nạp 1.000 xu' }).click();
  await expect(page).toHaveURL(new RegExp(`/payments/${CODE}$`));
  await expect(page.locator('[data-qr]')).toBeVisible();
  expect(state.creates).toHaveLength(1);
  expect(Object.keys(state.creates[0]).sort()).toEqual(['packageId', 'requestId']);
  await expect(page.getByRole('link', { name: /Mở trang thanh toán payOS/ })).toHaveAttribute('href', state.current.checkoutUrl);
  await page.screenshot({ path: 'test-results/payments-desktop.png', fullPage: true });
});

test('return URL cannot fake payment; confirmed payment updates wallet', async ({ page }) => {
  const state = await setup(page);
  // payOS appends its own query to the return URL the server built: /payments/<code>.
  await page.goto(`/payments/${CODE}?code=00&id=x&cancel=false&status=PAID&orderCode=${CODE}`);
  await expect(page.locator('[data-status]')).toHaveText('Chờ chuyển khoản');
  await expect(page.locator('.sl-pay-success')).toHaveCount(0);
  state.current = order('CREDITED');
  await page.getByRole('button', { name: 'Kiểm tra trạng thái' }).click();
  await expect(page.locator('.sl-pay-success')).toContainText('1.000 xu');
  await expect(page.locator('[data-wallet-balance]')).toContainText('1.500');
  await expect(page.locator('[data-qr]')).toHaveCount(0);
});

test('network failure retries the same idempotency key', async ({ page }) => {
  const state = await setup(page); state.failFirst = true;
  await page.goto('/payments');
  await page.getByRole('button', { name: 'Nạp 1.000 xu' }).click();
  await expect(page.locator('.sl-pay-error')).toBeVisible();
  await page.getByRole('button', { name: 'Nạp 1.000 xu' }).click();
  await expect(page.locator('[data-qr]')).toBeVisible();
  expect(state.creates).toHaveLength(2);
  expect(state.creates[1].requestId).toBe(state.creates[0].requestId);
});

test('disabled provider offers no active purchase buttons', async ({ page }) => {
  const state = await setup(page, false);
  await page.goto('/payments');
  await expect(page.getByRole('button', { name: 'Nạp 1.000 xu' })).toBeDisabled();
  await expect(page.locator('.sl-pay-notice')).toContainText('chưa được mở');
  expect(state.creates).toHaveLength(0);
});

test('mobile fits viewport; cancelling hides QR; leaving stops polling', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/payments/${CODE}`);
  await expect(page.locator('[data-qr]')).toBeVisible();
  await page.screenshot({ path: 'test-results/payments-mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(el => {
    const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1;
  }).map(el => `${el.tagName}.${el.className}: ${el.getBoundingClientRect().right}`));
  expect(overflow).toEqual([]);
  await page.getByRole('button', { name: 'Hủy đơn', exact: true }).click();
  await expect(page.locator('[data-status]')).toHaveText('Đã hủy');
  await expect(page.locator('[data-qr]')).toHaveCount(0);
  expect(state.cancels).toBe(1);
  // Start a pending page again, then leave before its timer fires.
  state.current = order();
  await page.reload();
  await expect(page.locator('[data-qr]')).toBeVisible();
  await page.getByRole('link', { name: 'Gói nạp & lịch sử' }).click();
  await expect(page.getByRole('button', { name: 'Nạp 1.000 xu' })).toBeVisible();
  const before = state.requests;
  await page.waitForTimeout(5500);
  expect(state.requests).toBe(before);
});

test('an order created before addresses lost the # still returns to its page from payOS', async ({ page }) => {
  await setup(page);
  // Orders made by the earlier release keep their return URL /#/payments/<code>; payOS adds its query on both sides.
  await page.goto(`/?code=00&status=PAID#/payments/${CODE}?status=PAID&code=00`);
  await expect(page).toHaveURL(new RegExp(`/payments/${CODE}\\?status=PAID&code=00$`));
  await expect(page.locator('[data-status]')).toHaveText('Chờ chuyển khoản');
  await expect(page.locator('.sl-pay-success')).toHaveCount(0);
});

test('the market links to the top-up page with a plain address', async ({ page }) => {
  await setup(page);
  await page.route((url) => url.pathname.startsWith('/api/market/'), (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }),
  }));
  await page.route((url) => url.pathname === '/api/market/me', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ success: true, data: { balance: 500, held: 0 } }),
  }));
  await page.goto('/market');
  const link = page.getByRole('link', { name: /Nạp xu/ });
  await expect(link).toHaveAttribute('href', '/payments');
  await link.click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.getByRole('button', { name: 'Nạp 1.000 xu' })).toBeVisible();
});
