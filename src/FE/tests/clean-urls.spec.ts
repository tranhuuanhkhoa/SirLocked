import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './helpers/adminSession';

/**
 * The site's addresses are plain paths: sirlocked.id.vn/admin, with no #. Links already out in the world (emails, invites,
 * bookmarks) still have the old #/ form, so those move to the clean address by themselves.
 */
const address = (page: Page) => page.evaluate(() => `${location.pathname}${location.search}${location.hash}`);
const expectAddress = (page: Page, wanted: string) => expect.poll(() => address(page)).toBe(wanted);
const activeNavLink = (page: Page) => page.locator('a.bpa-shell-link.is-active');

test.describe('clean addresses', () => {
  test('an address with no # opens its page and stays as typed', async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await page.goto('/admin');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Tổng quan');
    await expectAddress(page, '/admin');
  });

  test('a deep address keeps its id and query, also after a reload', async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await page.goto('/admin/players/u42?tab=kho');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Người chơi');
    await expectAddress(page, '/admin/players/u42?tab=kho');
    await page.reload();
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Người chơi');
    await expectAddress(page, '/admin/players/u42?tab=kho');
  });

  test('no link on the page uses the old form', async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await page.goto('/admin');
    await expect(page.locator('.admin-nav-tab').first()).toBeVisible();
    await expect(page.locator('a[href^="#/"]')).toHaveCount(0);
    await expect(page.locator('.admin-nav-tab[href="/admin/players"]')).toHaveCount(1);
  });

  test('clicking a link changes the address without reloading the site', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/cases');
    await expect(activeNavLink(page)).toHaveAttribute('href', '/cases');
    await page.evaluate(() => { (window as any).__notReloaded = true; });
    await page.locator('a.bpa-shell-link[href="/market"]').click();
    await expectAddress(page, '/market');
    await expect(activeNavLink(page)).toHaveAttribute('href', '/market');
    expect(await page.evaluate(() => (window as any).__notReloaded)).toBe(true);
  });

  test('back and forward move between pages without reloading the site', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/cases');
    await expect(activeNavLink(page)).toHaveAttribute('href', '/cases');
    await page.evaluate(() => { (window as any).__notReloaded = true; });
    await page.locator('a.bpa-shell-link[href="/market"]').click();
    await expect(activeNavLink(page)).toHaveAttribute('href', '/market');
    await page.goBack();
    await expectAddress(page, '/cases');
    await expect(activeNavLink(page)).toHaveAttribute('href', '/cases');
    await page.goForward();
    await expectAddress(page, '/market');
    await expect(activeNavLink(page)).toHaveAttribute('href', '/market');
    expect(await page.evaluate(() => (window as any).__notReloaded)).toBe(true);
  });

  test('a link clicked with ctrl held is left to the browser, for a new tab', async ({ page, context }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/cases');
    await expect(activeNavLink(page)).toHaveAttribute('href', '/cases');
    const opened = context.waitForEvent('page');
    await page.locator('a.bpa-shell-link[href="/market"]').click({ modifiers: ['Control'] });
    const tab = await opened;
    await tab.close();
    await expectAddress(page, '/cases');
  });

  test('going to the page already open does not run the page again', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/cases');
    await expect(activeNavLink(page)).toHaveAttribute('href', '/cases');
    const before = await page.evaluate(() => history.length);
    await activeNavLink(page).click();
    await expectAddress(page, '/cases');
    expect(await page.evaluate(() => history.length)).toBe(before);
  });

  test('the root is the introduction page, signed in or not, and keeps its address', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#hero-title')).toBeVisible();
    await expectAddress(page, '/');
    await signInAs(page, 'PLAYER');
    await page.goto('/?ref=zalo');
    await expect(page.locator('#hero-title')).toBeVisible();
    await expectAddress(page, '/?ref=zalo');
  });

  test('someone signed out is sent to the login page', async ({ page }) => {
    await page.goto('/cases');
    await expectAddress(page, '/login');
  });

  test('someone signed out at an admin address, old form or new, is sent to the admin login page', async ({ page }) => {
    await page.goto('/admin');
    await expectAddress(page, '/admin/login');
    await page.goto('/#/admin/players');
    await expectAddress(page, '/admin/login');
  });

  test('an address nobody knows goes home', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/khong-co-trang-nay');
    await expectAddress(page, '/menu');
  });

  test('a slash at the end still opens the page', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/market/');
    await expectAddress(page, '/market');
    await expect(activeNavLink(page)).toHaveAttribute('href', '/market');
  });

  test('a query a messaging app adds does not lose the page', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/market?fbclid=abc');
    await expect(activeNavLink(page)).toHaveAttribute('href', '/market');
    await expectAddress(page, '/market?fbclid=abc');
  });
});

test.describe('old links with #', () => {
  for (const [old, clean] of [
    ['/#/market', '/market'],
    ['/#/admin/players/u42?tab=kho', '/admin/players/u42?tab=kho'],
    ['/#/join?code=ABC123', '/join?code=ABC123'],
    ['/?fbclid=abc#/market', '/market'],
  ]) {
    test(`${old} moves to ${clean}`, async ({ page }) => {
      await signInAs(page, 'ADMIN');
      await page.goto(old);
      await expectAddress(page, clean);
    });
  }

  test('one pasted into a tab already open moves too', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/market');
    await expect(activeNavLink(page)).toHaveAttribute('href', '/market');
    await page.evaluate(() => { window.location.hash = '#/cases'; });
    await expectAddress(page, '/cases');
    await expect(activeNavLink(page)).toHaveAttribute('href', '/cases');
  });

  test('a crafted one cannot take anyone off the site', async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto('/#//evil.example/phish');
    await expect(page.locator('#hero-title')).toBeVisible();
    await expectAddress(page, '/');
    expect(new URL(page.url()).host).toBe(new URL(test.info().project.use.baseURL!).host);
  });

  test('an invite saved before this change is still honoured', async ({ page }) => {
    await page.goto('/login');
    const destination = await page.evaluate(async () => {
      localStorage.setItem('sirlocked.pendingInvite', JSON.stringify({ destination: '#/join?code=ABC123', expiresAt: Date.now() + 60_000 }));
      const { pendingRoomInvite } = await import('/Client/js/services/roomInvites.js' as string);
      return pendingRoomInvite();
    });
    expect(destination).toBe('/join?code=ABC123');
  });
});

test('an invite link has no #', async ({ page }) => {
  await page.goto('/login');
  const link = await page.evaluate(async () => {
    const { roomInviteUrl } = await import('/Client/js/services/roomInvites.js' as string);
    return roomInviteUrl('ABC123');
  });
  expect(link).toBe(new URL('/join?code=ABC123', page.url()).href);
});

test.describe('signing in with Google', () => {
  const answerMe = (page: Page) => page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { userId: 'u1', fullName: 'Yến', role: 'PLAYER', isEmailVerified: true } }),
  }));

  test('the tokens arrive after the # so the server never logs them, and leave no trace in the address', async ({ page }) => {
    await answerMe(page);
    await page.goto('/oauth-callback#token=access-1&refreshToken=refresh-1');
    await expectAddress(page, '/menu');
    expect(await page.evaluate(() => localStorage.getItem('sirlocked.token'))).toBe('access-1');
    expect(await page.evaluate(() => localStorage.getItem('sirlocked.refreshToken'))).toBe('refresh-1');
  });

  test('going back does not return to the address that held the tokens', async ({ page }) => {
    await answerMe(page);
    await page.goto('/oauth-callback#token=access-1&refreshToken=refresh-1');
    await expectAddress(page, '/menu');
    await page.goBack();
    expect(page.url()).not.toContain('access-1');
  });

  test('a redirect sent before this change still signs in', async ({ page }) => {
    await answerMe(page);
    await page.goto('/#/oauth-callback?token=access-1&refreshToken=refresh-1');
    await expectAddress(page, '/menu');
    expect(await page.evaluate(() => localStorage.getItem('sirlocked.token'))).toBe('access-1');
  });
});
