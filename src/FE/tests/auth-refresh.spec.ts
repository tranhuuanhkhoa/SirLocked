import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const initial = auth('account-a', 'expired-access', 'original-refresh');
const rotated = auth('account-a', 'new-access', 'rotated-refresh');

function auth(userId: string, token: string, refreshToken: string) {
  return {
    token, refreshToken, refreshTokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
    user: { userId, fullName: userId, role: 'PLAYER', isEmailVerified: true },
  };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function prepare(context: BrowserContext, page: Page) {
  // Load the actual API/session modules without mounting unrelated game routes.
  await context.route('**/auth-refresh-harness', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Auth refresh harness</title>',
  }));
  await page.goto('/auth-refresh-harness');
  await save(page, initial);
}

async function save(page: Page, value: ReturnType<typeof auth>) {
  await page.evaluate(async (value) => {
    const modulePath = '/Client/js/services/session.js';
    const { session } = await import(modulePath);
    session.save(value);
  }, value);
}

async function snapshot(page: Page) {
  return page.evaluate(() => ({
    token: localStorage.getItem('sirlocked.token'),
    refreshToken: localStorage.getItem('sirlocked.refreshToken'),
    userId: JSON.parse(localStorage.getItem('sirlocked.user') || 'null')?.userId ?? null,
    hash: location.hash,
  }));
}

async function request(page: Page, count = 1, path = '/api/protected-write') {
  return page.evaluate(async ({ count, path }) => {
    const modulePath = '/Client/js/api/http.js';
    const { post } = await import(modulePath);
    return Promise.all(Array.from({ length: count }, async () => {
      try { return { ok: true, value: await post(path, { action: 'test' }) }; }
      catch (error: any) { return { ok: false, status: error.status }; }
    }));
  }, { count, path });
}

test('two tabs and parallel 401s rotate once and recover every request', async ({ context, page }) => {
  await prepare(context, page);
  const other = await context.newPage();
  await other.goto('/auth-refresh-harness');
  expect(await page.evaluate(() => Boolean(navigator.locks))).toBe(true);
  const allInitialRequests = gate();
  let rejected = 0;
  let refreshCalls = 0;
  let successfulWrites = 0;
  await context.route('**/api/protected-write', async (route) => {
    if (route.request().headers().authorization === `Bearer ${initial.token}`) {
      if (++rejected === 4) allInitialRequests.release();
      await allInitialRequests.promise;
      await route.fulfill({ status: 401, json: { success: false } });
    } else {
      expect(route.request().headers().authorization).toBe(`Bearer ${rotated.token}`);
      successfulWrites++;
      await route.fulfill({ json: { success: true, data: { actor: 'account-a' } } });
    }
  });
  await context.route('**/api/auth/refresh', (route) => {
    refreshCalls++;
    expect(route.request().postDataJSON().refreshToken).toBe(initial.refreshToken);
    return route.fulfill(refreshCalls === 1
      ? { json: { success: true, data: rotated } }
      : { status: 401, json: { success: false } });
  });

  const results = (await Promise.all([request(page, 2), request(other, 2)])).flat();

  expect(results).toEqual(Array(4).fill({ ok: true, value: { actor: 'account-a' } }));
  expect(refreshCalls).toBe(1);
  expect(successfulWrites).toBe(4);
  expect(await snapshot(other)).toMatchObject({ token: rotated.token, refreshToken: rotated.refreshToken, userId: 'account-a' });
});

for (const locksAvailable of [true, false]) {
  test(`a stale failed refresh preserves a newer same-account session (Web Locks ${locksAvailable})`, async ({ context, page }) => {
    await prepare(context, page);
    if (!locksAvailable) await page.evaluate(() => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }));
    const other = await context.newPage();
    await other.goto('/auth-refresh-harness');
    const seen = gate();
    const response = gate();
    await context.route('**/api/protected-write', (route) => route.fulfill(
      route.request().headers().authorization === `Bearer ${rotated.token}`
        ? { json: { success: true, data: 'recovered' } }
        : { status: 401, json: { success: false } }));
    await context.route('**/api/auth/refresh', async (route) => {
      seen.release();
      await response.promise;
      await route.fulfill({ status: 401, json: { success: false } });
    });

    const pending = request(page);
    await seen.promise;
    await save(other, rotated);
    response.release();

    expect(await pending).toEqual([{ ok: true, value: 'recovered' }]);
    expect(await snapshot(page)).toMatchObject({ token: rotated.token, refreshToken: rotated.refreshToken, hash: '' });
  });
}

test('a refresh response received after logout cannot recreate the session', async ({ context, page }) => {
  await prepare(context, page);
  const seen = gate();
  const response = gate();
  let protectedCalls = 0;
  await context.route('**/api/protected-write', (route) => {
    protectedCalls++;
    return route.fulfill({ status: 401, json: { success: false } });
  });
  await context.route('**/api/auth/refresh', async (route) => {
    seen.release();
    await response.promise;
    await route.fulfill({ json: { success: true, data: rotated } });
  });

  const pending = request(page);
  await seen.promise;
  await page.evaluate(async () => {
    const modulePath = '/Client/js/services/session.js';
    const { session } = await import(modulePath);
    session.clear();
  });
  response.release();

  expect(await pending).toEqual([{ ok: false, status: 401 }]);
  expect(protectedCalls).toBe(1);
  expect(await snapshot(page)).toMatchObject({ token: null, refreshToken: null, userId: null });
});

for (const refreshStatus of [200, 401]) {
  test(`switching accounts while refresh is pending preserves the new account and never replays its action (${refreshStatus})`, async ({ context, page }) => {
    await prepare(context, page);
    const seen = gate();
    const response = gate();
    const newAccount = auth('account-b', 'other-access', 'other-refresh');
    const calls: string[] = [];
    await context.route('**/api/protected-write', (route) => {
      calls.push(route.request().headers().authorization);
      return route.fulfill({ status: 401, json: { success: false } });
    });
    await context.route('**/api/auth/refresh', async (route) => {
      seen.release();
      await response.promise;
      await route.fulfill({ status: refreshStatus, json: { success: refreshStatus === 200, data: rotated } });
    });

    const pending = request(page);
    await seen.promise;
    await save(page, newAccount);
    response.release();

    expect(await pending).toEqual([{ ok: false, status: 401 }]);
    expect(calls).toEqual([`Bearer ${initial.token}`]);
    expect(await snapshot(page)).toMatchObject({ token: newAccount.token, refreshToken: newAccount.refreshToken, userId: 'account-b', hash: '' });
  });
}

for (const failure of ['network', '503']) {
  test(`a transient ${failure} refresh failure keeps the shared session`, async ({ context, page }) => {
    await prepare(context, page);
    await context.route('**/api/protected-write', (route) => route.fulfill({ status: 401, json: { success: false } }));
    await context.route('**/api/auth/refresh', (route) => failure === 'network'
      ? route.abort('failed')
      : route.fulfill({ status: 503, json: { success: false } }));

    expect(await request(page)).toEqual([{ ok: false, status: failure === 'network' ? 0 : 503 }]);
    expect(await snapshot(page)).toMatchObject({ token: initial.token, refreshToken: initial.refreshToken, hash: '' });
  });
}

test('a definitively revoked unchanged session is cleared', async ({ context, page }) => {
  await prepare(context, page);
  await context.route('**/api/protected-write', (route) => route.fulfill({ status: 401, json: { success: false } }));
  await context.route('**/api/auth/refresh', (route) => route.fulfill({ status: 401, json: { success: false } }));

  expect(await request(page)).toEqual([{ ok: false, status: 401 }]);
  expect(await snapshot(page)).toMatchObject({ token: null, refreshToken: null, hash: '#/login' });
});

test('a public login 401 neither refreshes nor revokes an existing session', async ({ context, page }) => {
  await prepare(context, page);
  let refreshCalls = 0;
  await context.route('**/api/auth/login', (route) => route.fulfill({ status: 401, json: { success: false } }));
  await context.route('**/api/auth/refresh', (route) => {
    refreshCalls++;
    return route.fulfill({ status: 401, json: { success: false } });
  });

  expect(await request(page, 1, '/api/auth/login')).toEqual([{ ok: false, status: 401 }]);
  expect(refreshCalls).toBe(0);
  expect(await snapshot(page)).toMatchObject({ token: initial.token, refreshToken: initial.refreshToken, hash: '' });
});
