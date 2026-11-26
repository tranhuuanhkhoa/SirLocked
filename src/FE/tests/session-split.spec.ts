import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * The game and the admin pages keep separate sessions in one browser: signing in, signing out or running out on one side
 * leaves the other as it was. The admin side is stored under sirlocked.admin.*, the game side under sirlocked.* as before.
 */
type Role = 'PLAYER' | 'VIP' | 'ADMIN';
type Auth = ReturnType<typeof auth>;

function auth(userId: string, role: Role, token: string) {
  return {
    token,
    refreshToken: `${token}-refresh`,
    refreshTokenExpiry: '2099-01-01T00:00:00.000Z',
    user: { userId, fullName: `Tên ${userId}`, email: `${userId}@tests.invalid`, role, isEmailVerified: true },
  };
}

const PLAYER = auth('p1', 'PLAYER', 'player-token');
const VIP = auth('v1', 'VIP', 'vip-token');
const ADMIN = auth('a1', 'ADMIN', 'admin-token');
const ADMIN_ON_GAME_SIDE = auth('a1', 'ADMIN', 'admin-game-side-token');

const GAME_KEYS = { token: 'sirlocked.token', user: 'sirlocked.user', refreshToken: 'sirlocked.refreshToken', expiry: 'sirlocked.refreshExpiry' };
const ADMIN_KEYS = {
  token: 'sirlocked.admin.token', user: 'sirlocked.admin.user', refreshToken: 'sirlocked.admin.refreshToken', expiry: 'sirlocked.admin.refreshExpiry',
};
const SPLIT_MARK = 'sirlocked.sessionsSplit';

/**
 * Puts sessions in the browser once per tab, before the site loads. `split: false` is a browser from before this change:
 * one shared session under sirlocked.* and no mark.
 */
async function seed(target: Page | BrowserContext, { game, admin, split = true }: { game?: Auth; admin?: Auth; split?: boolean }) {
  await target.addInitScript(({ game, admin, split, gameKeys, adminKeys, mark }) => {
    if (sessionStorage.getItem('test.seeded')) return;
    sessionStorage.setItem('test.seeded', '1');
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    if (split) localStorage.setItem(mark, '1');
    const put = (keys: typeof gameKeys, value: typeof game) => {
      if (!value) return;
      localStorage.setItem(keys.token, value.token);
      localStorage.setItem(keys.user, JSON.stringify(value.user));
      localStorage.setItem(keys.refreshToken, value.refreshToken);
      localStorage.setItem(keys.expiry, value.refreshTokenExpiry);
    };
    put(gameKeys, game);
    put(adminKeys, admin);
  }, { game, admin, split, gameKeys: GAME_KEYS, adminKeys: ADMIN_KEYS, mark: SPLIT_MARK });
}

/** Answers every API call with an empty success and remembers which token each one carried. Routes added later win. */
async function fakeApi(page: Page) {
  const bearers: string[] = [];
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    bearers.push((route.request().headers().authorization ?? '').replace(/^Bearer /, ''));
    return route.fulfill({ json: { success: true, data: null } });
  });
  return bearers;
}

const address = (page: Page) => page.evaluate(() => `${location.pathname}${location.search}`);
const expectAddress = (page: Page, wanted: string) => expect.poll(() => address(page)).toBe(wanted);
const stored = (page: Page, key: string) => page.evaluate((name) => localStorage.getItem(name), key);
const storedUser = async (page: Page, key: string) => JSON.parse(await stored(page, key) ?? 'null')?.userId ?? null;

async function submitAdminForm(page: Page) {
  await page.locator('#form-admin-login [name="email"]').fill('a1@tests.invalid');
  await page.locator('#form-admin-login [name="password"]').fill('Fixture-password1');
  await page.locator('#form-admin-login button[type="submit"]').click();
}

/** Where the previous page's requests end: none of them may be counted for the next page. */
async function settled(page: Page, bearers: string[]) {
  await page.waitForLoadState('networkidle');
  return bearers.length;
}

/** The tokens the page sent from `from` on, once it has sent at least one. */
async function tokensSent(bearers: string[], from: number) {
  await expect.poll(() => bearers.length).toBeGreaterThan(from);
  return [...new Set(bearers.slice(from).filter(Boolean))];
}

test.describe('signing in', () => {
  test('signing in on the admin page keeps the player signed in on the game side', async ({ page }) => {
    await seed(page, { game: PLAYER });
    const bearers = await fakeApi(page);
    await page.route((url) => url.pathname === '/api/auth/admin/login', (route) => route.fulfill({ json: { success: true, data: ADMIN } }));
    await page.goto('/admin/login');
    // Nothing is replaced any more, so nothing warns about it.
    await expect(page.locator('.adm-login-note')).toHaveCount(0);
    await submitAdminForm(page);
    await expectAddress(page, '/admin');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Tổng quan');

    expect(await stored(page, ADMIN_KEYS.token)).toBe(ADMIN.token);
    expect(await storedUser(page, ADMIN_KEYS.user)).toBe('a1');
    expect(await stored(page, GAME_KEYS.token)).toBe(PLAYER.token);
    expect(await stored(page, GAME_KEYS.refreshToken)).toBe(PLAYER.refreshToken);
    expect(await storedUser(page, GAME_KEYS.user)).toBe('p1');

    const before = await settled(page, bearers);
    await page.goto('/menu');
    await expectAddress(page, '/menu');
    expect(await tokensSent(bearers, before)).toEqual([PLAYER.token]);
  });

  test('admin pages call the server as the admin, game pages as the player', async ({ page }) => {
    await seed(page, { game: PLAYER, admin: ADMIN });
    const bearers = await fakeApi(page);
    await page.goto('/admin/players');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Người chơi');
    expect(await tokensSent(bearers, 0)).toEqual([ADMIN.token]);

    const before = await settled(page, bearers);
    await page.goto('/cases');
    await expectAddress(page, '/cases');
    expect(await tokensSent(bearers, before)).toEqual([PLAYER.token]);
  });

  test('an admin account signed in on the game side still signs in on the admin page', async ({ page }) => {
    await seed(page, { game: ADMIN_ON_GAME_SIDE });
    await fakeApi(page);
    await page.goto('/admin');
    await expectAddress(page, '/admin/login');
    await expect(page.locator('#form-admin-login')).toBeVisible();
    expect(await stored(page, GAME_KEYS.token)).toBe(ADMIN_ON_GAME_SIDE.token);
  });

  test('a player opening an admin page is asked to sign in as an admin', async ({ page }) => {
    await seed(page, { game: PLAYER });
    await fakeApi(page);
    await page.goto('/admin/chests');
    await expectAddress(page, '/admin/login');
    expect(await stored(page, GAME_KEYS.token)).toBe(PLAYER.token);
  });
});

test.describe('leaving', () => {
  test('signing out of the admin pages leaves the game side signed in', async ({ page }) => {
    await seed(page, { game: PLAYER, admin: ADMIN });
    await fakeApi(page);
    await page.goto('/admin');
    await page.locator('#nav-logout').click();
    await expectAddress(page, '/admin/login');
    expect(await stored(page, ADMIN_KEYS.token)).toBeNull();
    expect(await stored(page, ADMIN_KEYS.refreshToken)).toBeNull();
    expect(await stored(page, GAME_KEYS.token)).toBe(PLAYER.token);
    await page.goto('/menu');
    await expectAddress(page, '/menu');
  });

  test('signing out of the game leaves the admin pages signed in', async ({ page }) => {
    await seed(page, { game: PLAYER, admin: ADMIN });
    await fakeApi(page);
    await page.goto('/menu');
    await page.locator('#title-menu-logout').click();
    await expectAddress(page, '/login');
    expect(await stored(page, GAME_KEYS.token)).toBeNull();
    expect(await stored(page, ADMIN_KEYS.token)).toBe(ADMIN.token);
    await page.goto('/admin');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Tổng quan');
  });

  test('an admin account signing out on the game side goes to the player sign-in page', async ({ page }) => {
    await seed(page, { game: ADMIN_ON_GAME_SIDE, admin: ADMIN });
    await fakeApi(page);
    await page.goto('/menu');
    await page.locator('#title-menu-logout').click();
    await expectAddress(page, '/login');
    expect(await stored(page, ADMIN_KEYS.token)).toBe(ADMIN.token);
  });

  test('an admin session that ran out ends on the admin side only', async ({ page }) => {
    await seed(page, { game: PLAYER, admin: ADMIN });
    await fakeApi(page);
    let refreshedSide = '';
    let refreshBody: string | null = 'unset';
    await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
      const sent = route.request().headers().authorization ?? '';
      if (sent === `Bearer ${ADMIN.token}`) return route.fulfill({ status: 401, json: { success: false, message: 'expired' } });
      return route.fallback();
    });
    await page.route((url) => url.pathname === '/api/auth/refresh', (route) => {
      // The refresh token is the admin side's HttpOnly cookie: the request names the side and carries no token itself.
      refreshedSide = route.request().headers()['x-sirlocked-session'] ?? '';
      refreshBody = route.request().postData();
      return route.fulfill({ status: 401, json: { success: false, message: 'expired' } });
    });
    await page.goto('/admin');
    await expectAddress(page, '/admin/login');
    expect(refreshedSide).toBe('admin');
    expect(refreshBody ?? '').not.toContain(ADMIN.refreshToken);
    expect(await stored(page, ADMIN_KEYS.token)).toBeNull();
    expect(await stored(page, GAME_KEYS.token)).toBe(PLAYER.token);
    expect(await stored(page, GAME_KEYS.refreshToken)).toBe(PLAYER.refreshToken);
  });
});

test.describe('the AI order page', () => {
  test('a VIP orders with their game account', async ({ page }) => {
    await seed(page, { game: VIP });
    const bearers = await fakeApi(page);
    await page.goto('/admin/ai');
    await expectAddress(page, '/admin/ai');
    expect(await tokensSent(bearers, 0)).toEqual([VIP.token]);
  });

  test('the admin session takes over when there is one', async ({ page }) => {
    await seed(page, { game: VIP, admin: ADMIN });
    const bearers = await fakeApi(page);
    await page.goto('/admin/ai');
    await expectAddress(page, '/admin/ai');
    expect(await tokensSent(bearers, 0)).toEqual([ADMIN.token]);
  });

  test('an admin account on the game side does not open it without the admin sign-in', async ({ page }) => {
    await seed(page, { game: ADMIN_ON_GAME_SIDE });
    const bearers = await fakeApi(page);
    await page.goto('/admin/ai');
    await expect.poll(() => address(page)).toMatch(/\/login$/);
    expect(bearers).not.toContain(ADMIN_ON_GAME_SIDE.token);
  });
});

test.describe('a browser from before the split', () => {
  test('a shared admin session moves to the admin side once, and the game side starts signed out', async ({ page }) => {
    await seed(page, { game: ADMIN, split: false });
    await fakeApi(page);
    await page.goto('/admin');
    await expect(page.locator('.admin-nav-tab.is-active')).toHaveText('Tổng quan');
    expect(await stored(page, ADMIN_KEYS.token)).toBe(ADMIN.token);
    expect(await stored(page, ADMIN_KEYS.refreshToken)).toBe(ADMIN.refreshToken);
    expect(await stored(page, GAME_KEYS.token)).toBeNull();
    expect(await stored(page, SPLIT_MARK)).toBe('1');

    // Later the admin account signs in on the game side on purpose: it stays there.
    await page.evaluate(({ keys, value }) => {
      localStorage.setItem(keys.token, value.token);
      localStorage.setItem(keys.user, JSON.stringify(value.user));
      localStorage.setItem(keys.refreshToken, value.refreshToken);
      localStorage.setItem(keys.expiry, value.refreshTokenExpiry);
    }, { keys: GAME_KEYS, value: ADMIN_ON_GAME_SIDE });
    await page.goto('/menu');
    await expectAddress(page, '/menu');
    expect(await stored(page, GAME_KEYS.token)).toBe(ADMIN_ON_GAME_SIDE.token);
    expect(await stored(page, ADMIN_KEYS.token)).toBe(ADMIN.token);
  });

  test('a shared player session stays on the game side', async ({ page }) => {
    await seed(page, { game: PLAYER, split: false });
    await fakeApi(page);
    await page.goto('/menu');
    await expectAddress(page, '/menu');
    expect(await stored(page, GAME_KEYS.token)).toBe(PLAYER.token);
    expect(await stored(page, ADMIN_KEYS.token)).toBeNull();
    expect(await stored(page, SPLIT_MARK)).toBe('1');
  });
});

test.describe('playtest rooms and token refresh', () => {
  async function harness(context: BrowserContext, page: Page, path: string) {
    // Loads the real session modules without mounting any page of the site.
    await context.route((url) => url.pathname.endsWith('/session-harness'), (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Session harness</title>',
    }));
    await page.goto(path);
  }

  test('the tab that opens a playtest from the admin pages plays that room as the admin; other tabs and rooms stay on the game side', async ({ context, page }) => {
    await seed(context, { game: PLAYER, admin: ADMIN });
    await harness(context, page, '/admin/session-harness');
    const scopes = await page.evaluate(async () => {
      const modulePath = '/Client/js/services/session.js';
      const { sessionScope, rememberAdminRoom } = await import(modulePath);
      rememberAdminRoom('room-7');
      const at = (path: string) => { history.replaceState(null, '', path); return sessionScope(); };
      const seen = { lobby: at('/lobby/room-7'), game: at('/game/room-7'), result: at('/result/room-7'), otherRoom: at('/lobby/room-8'), menu: at('/menu') };
      // A room opened from a game page (a VIP's own playtest, an ordinary room) is not the admin's.
      rememberAdminRoom('room-9');
      return { ...seen, fromGamePage: at('/lobby/room-9') };
    });
    expect(scopes).toEqual({ lobby: 'admin', game: 'admin', result: 'admin', otherRoom: 'player', menu: 'player', fromGamePage: 'player' });

    const other = await context.newPage();
    await other.goto('/session-harness');
    const inOtherTab = await other.evaluate(async () => {
      const modulePath = '/Client/js/services/session.js';
      const { sessionScope } = await import(modulePath);
      history.replaceState(null, '', '/lobby/room-7');
      return sessionScope();
    });
    expect(inOtherTab).toBe('player');
  });

  test('a refresh on an admin page rotates the admin session and leaves the player session alone', async ({ context, page }) => {
    const rotated = auth('a1', 'ADMIN', 'admin-token-2');
    await seed(context, { game: PLAYER, admin: ADMIN });
    await harness(context, page, '/admin/session-harness');
    let refreshedSide = '';
    let refreshClient = '';
    await context.route((url) => url.pathname === '/api/protected-write', (route) => route.fulfill(
      route.request().headers().authorization === `Bearer ${rotated.token}`
        ? { json: { success: true, data: 'done' } }
        : { status: 401, json: { success: false } },
    ));
    await context.route((url) => url.pathname === '/api/auth/refresh', (route) => {
      refreshedSide = route.request().headers()['x-sirlocked-session'] ?? '';
      refreshClient = route.request().headers()['x-sirlocked-client'] ?? '';
      return route.fulfill({ json: { success: true, data: rotated } });
    });
    const answer = await page.evaluate(async () => {
      const modulePath = '/Client/js/api/http.js';
      const { post } = await import(modulePath);
      return post('/api/protected-write', {});
    });
    expect(answer).toBe('done');
    expect(refreshedSide).toBe('admin');
    expect(refreshClient).toBe('web');
    expect(await stored(page, ADMIN_KEYS.token)).toBe(rotated.token);
    // The rotated refresh token stays in the admin cookie; an old copy in storage is removed.
    expect(await stored(page, ADMIN_KEYS.refreshToken)).toBeNull();
    expect(await stored(page, GAME_KEYS.token)).toBe(PLAYER.token);
    expect(await stored(page, GAME_KEYS.refreshToken)).toBe(PLAYER.refreshToken);
  });
});
