import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const initial = auth('account-a', 'expired-access');
const rotated = auth('account-a', 'new-access');

function auth(userId: string, token: string) {
  return {
    token, refreshTokenExpiry: new Date(Date.now() + 3_600_000).toISOString(),
    user: { userId, fullName: userId, role: 'PLAYER', isEmailVerified: true },
  };
}

function jwtExpiringIn(seconds: number) {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }));
  return `header.${payload}.signature`;
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
  await context.addCookies([{
    name: 'sirlocked_refresh',
    value: 'original-refresh',
    domain: new URL(page.url()).hostname,
    path: '/api/auth',
    httpOnly: true,
    sameSite: 'Strict',
  }]);
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
    path: location.pathname,
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
    expect(route.request().postData()).toBeNull();
    expect(route.request().headers()['x-sirlocked-client']).toBe('web');
    expect(route.request().headers().cookie).toContain('sirlocked_refresh=original-refresh');
    return route.fulfill(refreshCalls === 1
      ? { json: { success: true, data: rotated }, headers: { 'set-cookie': 'sirlocked_refresh=rotated-refresh; Path=/api/auth; HttpOnly; SameSite=Strict' } }
      : { status: 401, json: { success: false } });
  });

  const results = (await Promise.all([request(page, 2), request(other, 2)])).flat();

  expect(results).toEqual(Array(4).fill({ ok: true, value: { actor: 'account-a' } }));
  expect(refreshCalls).toBe(1);
  expect(successfulWrites).toBe(4);
  expect(await snapshot(other)).toMatchObject({ token: rotated.token, refreshToken: null, userId: 'account-a' });
});

test('SignalR access token factory refreshes a session expiring within one minute', async ({ context, page }) => {
  await prepare(context, page);
  const expiring = auth('account-a', jwtExpiringIn(30));
  await save(page, expiring);
  let refreshCalls = 0;
  await context.route('**/api/auth/refresh', (route) => {
    refreshCalls++;
    expect(route.request().postData()).toBeNull();
    expect(route.request().headers()['x-sirlocked-client']).toBe('web');
    return route.fulfill({ json: { success: true, data: rotated } });
  });

  const token = await page.evaluate(async () => {
    const { freshAccessToken } = await import('/Client/js/services/authRefresh.js');
    return freshAccessToken();
  });

  expect(token).toBe(rotated.token);
  expect(refreshCalls).toBe(1);
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
    expect(await snapshot(page)).toMatchObject({ token: rotated.token, refreshToken: null, path: '/auth-refresh-harness' });
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
    const newAccount = auth('account-b', 'other-access');
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
    expect(await snapshot(page)).toMatchObject({ token: newAccount.token, refreshToken: null, userId: 'account-b', path: '/auth-refresh-harness' });
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
    expect(await snapshot(page)).toMatchObject({ token: initial.token, refreshToken: null, path: '/auth-refresh-harness' });
  });
}

test('a definitively revoked unchanged session is cleared', async ({ context, page }) => {
  await prepare(context, page);
  await context.route('**/api/protected-write', (route) => route.fulfill({ status: 401, json: { success: false } }));
  await context.route('**/api/auth/refresh', (route) => route.fulfill({ status: 401, json: { success: false } }));

  expect(await request(page)).toEqual([{ ok: false, status: 401 }]);
  expect(await snapshot(page)).toMatchObject({ token: null, refreshToken: null, path: '/login' });
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
  expect(await snapshot(page)).toMatchObject({ token: initial.token, refreshToken: null, path: '/auth-refresh-harness' });
});

async function sendForm(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/Client/js/api/http.js';
    const { apiFetchForm } = await import(modulePath);
    const form = new FormData();
    form.append('file', new Blob(['picture']), 'a.webp');
    return apiFetchForm('/api/form-write', form).then((data: unknown) => ({ data }), (error: { status: number }) => ({ status: error.status }));
  });
}

test('a form upload with an expired token refreshes once and sends the same form again', async ({ context, page }) => {
  await prepare(context, page);
  const seen: Array<{ auth?: string; hasFile: boolean }> = [];
  await context.route('**/api/auth/refresh', (route) => route.fulfill({ json: { success: true, data: rotated } }));
  await context.route('**/api/form-write', (route) => {
    const auth = route.request().headers().authorization;
    seen.push({ auth, hasFile: route.request().headers()['content-type']?.startsWith('multipart/form-data') ?? false });
    return auth === 'Bearer new-access'
      ? route.fulfill({ json: { success: true, data: { stored: true } } })
      : route.fulfill({ status: 401, json: { success: false, message: 'expired' } });
  });

  expect(await sendForm(page)).toEqual({ data: { stored: true } });

  expect(seen).toEqual([{ auth: 'Bearer expired-access', hasFile: true }, { auth: 'Bearer new-access', hasFile: true }]);
  expect((await snapshot(page)).token).toBe('new-access');
});

test('a form upload refused again after the refresh ends the session instead of trying forever', async ({ context, page }) => {
  await prepare(context, page);
  let attempts = 0;
  await context.route('**/api/auth/refresh', (route) => route.fulfill({ json: { success: true, data: rotated } }));
  await context.route('**/api/form-write', (route) => { attempts++; return route.fulfill({ status: 401, json: { success: false, message: 'refused' } }); });

  expect(await sendForm(page)).toEqual({ status: 401 });

  expect(attempts).toBe(2);
  expect((await snapshot(page)).token).toBeNull();
});
