import { mkdirSync } from 'node:fs';
import { expect, request, test, type Page } from '@playwright/test';

/**
 * The two sign-in pages against a running API (Development, loopback Mongo), with a real player and the seeded admin.
 * Sign-ins are limited to five a minute per address and this round uses all five, so wait a minute between reruns.
 *
 *   SIRLOCKED_RUN_ADMIN_LOGIN_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://127.0.0.1:5321 \
 *   SIRLOCKED_TEST_ADMIN_EMAIL=admin@sirlocked.local SIRLOCKED_TEST_ADMIN_PASSWORD=<local demo password> \
 *   SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5191 SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 \
 *   SIRLOCKED_ADMIN_EVIDENCE_DIR=../../tmp/admin-evidence/admin-login \
 *   node ./node_modules/@playwright/test/cli.js test tests/admin-login-full-stack.spec.ts
 *
 * The API must run with Auth__AutoVerifyRegistrations=true.
 */
const enabled = process.env.SIRLOCKED_RUN_ADMIN_LOGIN_FULL_STACK === 'true';
const evidenceDir = process.env.SIRLOCKED_ADMIN_EVIDENCE_DIR;
const PLAYER_PASSWORD = 'Admin-login-e2e-1!';

const address = (page: Page) => page.evaluate(() => `${location.pathname}${location.search}`);
const expectAddress = (page: Page, wanted: string) => expect.poll(() => address(page)).toBe(wanted);
const stored = (page: Page, key: string) => page.evaluate((name) => localStorage.getItem(name), key);

async function fill(page: Page, form: string, email: string, password: string) {
  await page.locator(`${form} [name="email"]`).fill(email);
  await page.locator(`${form} [name="password"]`).fill(password);
  await page.locator(`${form} button[type="submit"]`).click();
}

async function picture(page: Page, name: string) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  await expect(page.locator('.bpa-rim')).toHaveCount(0);
  await page.screenshot({ path: `${evidenceDir}/${name}.png` });
}

test('players and admins each use their own sign-in page', async ({ browser }) => {
  test.skip(!enabled, 'Needs a running API: see the top of this file.');
  test.setTimeout(120_000);
  const adminEmail = process.env.SIRLOCKED_TEST_ADMIN_EMAIL ?? '';
  const adminPassword = process.env.SIRLOCKED_TEST_ADMIN_PASSWORD ?? '';
  const api = await request.newContext({ baseURL: process.env.SIRLOCKED_TEST_API_URL });
  const playerEmail = `admin-login-${Date.now()}@tests.invalid`;
  const registered = await api.post('/api/auth/register', {
    data: { fullName: 'Thám tử TEST', email: playerEmail, password: PLAYER_PASSWORD },
    headers: { 'X-Forwarded-For': `10.83.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` },
  });
  expect(registered.ok(), await registered.text()).toBe(true);

  const context = await browser.newContext({ locale: 'vi-VN' });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('sirlocked.uiLanguage', 'vi'));

  await test.step('signed out, an admin address opens the admin page', async () => {
    await page.goto('/admin/players');
    await expectAddress(page, '/admin/login');
    await expect(page.getByRole('heading', { name: 'Đăng nhập quản trị' })).toBeVisible();
    await picture(page, '01-may-tinh-chua-dang-nhap');
  });

  await test.step('a player signs in on their own page and lands on the menu', async () => {
    await page.goto('/login');
    await fill(page, '#form-login', playerEmail, PLAYER_PASSWORD);
    await expectAddress(page, '/menu');
  });
  const playerToken = await stored(page, 'sirlocked.token');
  const playerRefresh = await stored(page, 'sirlocked.refreshToken');

  await test.step('the same player is refused on the admin page, with the right password', async () => {
    await page.goto('/admin/login');
    await expect(page.locator('.adm-login-note')).toContainText('Thám tử TEST');
    await fill(page, '#form-admin-login', playerEmail, PLAYER_PASSWORD);
    await expect(page.getByRole('alert')).toContainText('không có quyền admin');
    await picture(page, '02-nguoi-choi-bi-tu-choi');
    expect(await stored(page, 'sirlocked.token')).toBe(playerToken);
  });

  await test.step('a wrong admin password is refused and the player stays signed in', async () => {
    await fill(page, '#form-admin-login', adminEmail, 'Wrong-password-123!');
    await expect(page.getByRole('alert')).toContainText('Sai email hoặc mật khẩu');
    expect(await stored(page, 'sirlocked.token')).toBe(playerToken);
  });

  await test.step('neither refusal ended the session on the server', async () => {
    const refreshed = await api.post('/api/auth/refresh', { data: { refreshToken: playerRefresh } });
    expect(refreshed.ok(), await refreshed.text()).toBe(true);
    const auth = (await refreshed.json()).data;
    // The refresh above replaced the one-use token, so hand the new one to the browser.
    await page.evaluate(({ token, refreshToken }) => {
      localStorage.setItem('sirlocked.token', token);
      localStorage.setItem('sirlocked.refreshToken', refreshToken);
    }, auth);
  });

  await test.step('the admin signs in over that session and reaches the dashboard', async () => {
    await fill(page, '#form-admin-login', adminEmail, adminPassword);
    await expectAddress(page, '/admin');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Tổng quan');
    expect(JSON.parse(await stored(page, 'sirlocked.user') ?? '{}').role).toBe('ADMIN');
    await picture(page, '03-admin-vao-tong-quan');
  });

  await test.step('an admin page really answers with this session', async () => {
    await page.goto('/admin/players');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Người chơi');
    await expect(page.getByText(playerEmail)).toBeVisible();
  });

  await test.step('signing out returns to the admin page', async () => {
    await page.locator('#nav-logout').click();
    await expectAddress(page, '/admin/login');
    expect(await stored(page, 'sirlocked.token')).toBeNull();
  });

  await test.step('an admin on the player page lands on the menu and can still open the admin pages', async () => {
    await page.goto('/login');
    await fill(page, '#form-login', adminEmail, adminPassword);
    await expectAddress(page, '/menu');
    await page.goto('/admin');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Tổng quan');
  });

  await context.close();

  await test.step('on a phone, the page fits', async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'vi-VN' });
    const phonePage = await phone.newPage();
    await phonePage.addInitScript(() => localStorage.setItem('sirlocked.uiLanguage', 'vi'));
    await phonePage.goto('/admin/login');
    await expect(phonePage.locator('#form-admin-login')).toBeVisible();
    await picture(phonePage, '04-dien-thoai');
    expect(await phonePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await phone.close();
  });

  await api.dispose();
});
