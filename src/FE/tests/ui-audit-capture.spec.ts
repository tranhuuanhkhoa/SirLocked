import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Investigation-only harness: walks the player journey and writes a screenshot per screen so a
 * UI audit can be based on the rendered result rather than on reading CSS. It asserts nothing about
 * design and is skipped unless SIRLOCKED_RUN_UI_AUDIT is set, so it never runs in CI.
 */
const enabled = process.env.SIRLOCKED_RUN_UI_AUDIT === 'true';
const password = process.env.SIRLOCKED_TEST_PASSWORD ?? '';
const apiBaseUrl = process.env.SIRLOCKED_TEST_API_URL ?? 'http://127.0.0.1:5215';
const shots = process.env.SIRLOCKED_UI_AUDIT_DIR ?? 'ui-audit';

type Auth = {
  token: string;
  refreshToken: string;
  refreshTokenExpiry: string;
  user: { userId: string; fullName: string; role: string; isEmailVerified: boolean };
};

test.describe('UI audit capture', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!enabled, 'Investigation harness; set SIRLOCKED_RUN_UI_AUDIT=true.');
  test.setTimeout(120_000);

  let api: APIRequestContext;
  let investigator: Auth;
  let interrogator: Auth;

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
    investigator = await login(api, 'it_investigator@tests.invalid');
    interrogator = await login(api, 'it_interrogator@tests.invalid');
  });

  test.afterAll(async () => api?.dispose());

  test('capture the journey', async ({ browser }) => {
    const desktop = { width: 1366, height: 768 };

    // 1. Login — the only screen an anonymous visitor sees.
    const anon = await browser.newContext({ viewport: desktop });
    const anonPage = await anon.newPage();
    await anonPage.goto('/#/login');
    await anonPage.waitForTimeout(1200);
    await shot(anonPage, '01-login');
    await anon.close();

    // 2..n. Authenticated journey.
    const ctx = await browser.newContext({ viewport: desktop });
    const page = await ctx.newPage();
    await seedSession(page, investigator);

    await page.goto('/#/cases');
    await page.waitForTimeout(1800);
    await shot(page, '02-cases');

    const firstCase = page.locator('.case-card a, .case-card button, [href^="#/cases/"]').first();
    if (await firstCase.count()) {
      await firstCase.click();
      await page.waitForTimeout(1500);
      await shot(page, '03-case-detail');
    }

    await page.goto('/#/create-room');
    await page.waitForTimeout(1200);
    await shot(page, '04-create-room');

    await page.goto('/#/join');
    await page.waitForTimeout(1000);
    await shot(page, '05-join-room');

    await page.goto('/#/detective');
    await page.waitForTimeout(1500);
    await shot(page, '06-profile');

    await page.goto('/#/workshop');
    await page.waitForTimeout(1500);
    await shot(page, '07-workshop');

    // Lobby needs a real room.
    const room = await call<{ roomId: string; roomCode: string }>(
      api, 'POST', '/api/rooms', investigator.token, { caseId: 'case-v3-broken-seal-en' });
    await page.goto(`/#/lobby/${room.roomId}`);
    await page.waitForTimeout(1800);
    await shot(page, '08-lobby');

    // Game HUD needs both roles and a started room.
    await call(api, 'POST', `/api/rooms/${room.roomId}/select-role`, investigator.token, { role: 'INVESTIGATOR' });
    await call(api, 'POST', `/api/rooms/${room.roomId}/ready`, investigator.token, { isReady: true });
    await call(api, 'POST', '/api/rooms/join', interrogator.token, { roomCode: room.roomCode });
    await call(api, 'POST', `/api/rooms/${room.roomId}/select-role`, interrogator.token, { role: 'INTERROGATOR' });
    await call(api, 'POST', `/api/rooms/${room.roomId}/ready`, interrogator.token, { isReady: true });
    await call(api, 'POST', `/api/rooms/${room.roomId}/start`, investigator.token, {});

    await page.addInitScript((roomId) => {
      window.sessionStorage.setItem(`sirlocked.intro.${roomId}`, '1');
    }, room.roomId);
    await page.goto(`/#/game/${room.roomId}`);
    await expect(page.locator('#case-file-btn')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    await shot(page, '09-game-hud');

    await page.locator('#case-file-btn').click();
    await page.waitForTimeout(1200);
    await shot(page, '10-case-file');

    // Mobile view of the same HUD.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1500);
    await shot(page, '11-game-mobile');

    await ctx.close();
  });
});

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

async function seedSession(page: Page, auth: Auth) {
  await page.addInitScript((auth) => {
    window.localStorage.setItem('sirlocked.token', auth.token);
    window.localStorage.setItem('sirlocked.refreshToken', auth.refreshToken);
    window.localStorage.setItem('sirlocked.refreshExpiry', auth.refreshTokenExpiry);
    window.localStorage.setItem('sirlocked.user', JSON.stringify(auth.user));
    window.localStorage.setItem('sirlocked.uiLanguage', 'en');
  }, auth);
}

async function login(api: APIRequestContext, email: string): Promise<Auth> {
  return call<Auth>(api, 'POST', '/api/auth/login', undefined, { email, password });
}

async function call<T>(api: APIRequestContext, method: 'GET' | 'POST', path: string, token?: string, body?: unknown): Promise<T> {
  const response = await api.fetch(path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    data: body as never,
  });
  const text = await response.text();
  if (!response.ok()) throw new Error(`${method} ${path} -> ${response.status()} ${text.slice(0, 300)}`);
  return (JSON.parse(text).data ?? JSON.parse(text)) as T;
}
