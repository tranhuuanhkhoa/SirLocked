import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

const enabled = process.env.SIRLOCKED_RUN_V3_FULL_STACK === 'true';
const password = process.env.SIRLOCKED_V3_TEST_PASSWORD ?? '';
const apiBaseUrl = 'http://127.0.0.1:5174';

type Auth = {
  token: string;
  refreshToken: string;
  refreshTokenExpiry: string;
  user: { userId: string; fullName: string; role: string; isEmailVerified: boolean };
};

type Room = { roomId: string; roomCode: string };

test.describe('isolated local V3 full-stack flow', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!enabled, 'Run through scripts/test-v3-local-full-stack.ps1 with isolated local Mongo.');

  let api: APIRequestContext;
  let investigatorAuth: Auth;
  let interrogatorAuth: Auth;

  test.beforeAll(async () => {
    expect(password, 'The launcher must provide a process-only test password.').not.toBe('');
    api = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
    investigatorAuth = await login(api, 'audit_investigator@audit.invalid');
    interrogatorAuth = await login(api, 'audit_interrogator@audit.invalid');
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  for (const run of [1, 2, 3]) {
    test(`real HTTP/Auth/Mongo and two browser contexts complete V3 (run ${run})`, async ({ browser }) => {
      const room = await createStartedRoom(api, investigatorAuth, interrogatorAuth);
      await discoverPrivateKnowledge(api, room.roomId, investigatorAuth.token, interrogatorAuth.token);
      await assertServerPrivacy(api, room.roomId, investigatorAuth.token, interrogatorAuth.token);

      const investigator = await openPlayer(browser, room.roomId, investigatorAuth);
      const interrogator = await openPlayer(browser, room.roomId, interrogatorAuth);
      try {
        await runCrackLoop(investigator, interrogator);
        await assertWrongRoleErrorIsGeneric(api, room.roomId, investigatorAuth.token);
      } finally {
        await investigator.context().close();
        await interrogator.context().close();
      }
    });
  }
});

async function login(api: APIRequestContext, email: string): Promise<Auth> {
  return call<Auth>(api, 'POST', '/api/auth/login', undefined, { email, password });
}

async function createStartedRoom(api: APIRequestContext, investigator: Auth, interrogator: Auth): Promise<Room> {
  const room = await call<Room>(
    api,
    'POST',
    '/api/rooms',
    investigator.token,
    { caseId: 'case-v3-broken-seal-en' },
  );
  await call(api, 'POST', '/api/rooms/join', interrogator.token, { roomCode: room.roomCode });
  await call(api, 'POST', `/api/rooms/${room.roomId}/select-role`, investigator.token, { role: 'INVESTIGATOR' });
  await call(api, 'POST', `/api/rooms/${room.roomId}/select-role`, interrogator.token, { role: 'INTERROGATOR' });
  await call(api, 'POST', `/api/rooms/${room.roomId}/ready`, investigator.token, { isReady: true });
  await call(api, 'POST', `/api/rooms/${room.roomId}/ready`, interrogator.token, { isReady: true });
  await call(api, 'POST', `/api/rooms/${room.roomId}/start`, investigator.token);
  return room;
}

async function discoverPrivateKnowledge(
  api: APIRequestContext,
  roomId: string,
  investigatorToken: string,
  interrogatorToken: string,
) {
  for (const itemId of ['item-blue-wax-en', 'item-ticket-en', 'item-thread-en']) {
    await call(api, 'POST', `/api/game/rooms/${roomId}/inspect-item`, investigatorToken, { itemId });
  }
  await call(api, 'POST', `/api/game/rooms/${roomId}/ask-dialogue`, interrogatorToken, {
    dialogueId: 'dlg-mara-statement-en',
  });
}

async function assertServerPrivacy(
  api: APIRequestContext,
  roomId: string,
  investigatorToken: string,
  interrogatorToken: string,
) {
  const investigatorState = await rawCall(api, 'GET', `/api/game/rooms/${roomId}/state`, investigatorToken);
  const interrogatorState = await rawCall(api, 'GET', `/api/game/rooms/${roomId}/state`, interrogatorToken);
  expect(investigatorState.text).not.toContain('fragment-seal-intact-en');
  expect(investigatorState.text).not.toContain('The seal remained intact');
  expect(interrogatorState.text).not.toContain('evidence-blue-wax-en');
  expect(interrogatorState.text).not.toContain('Overlapping blue wax');
}

async function openPlayer(browser: Browser, roomId: string, auth: Auth): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(({ roomId, auth }) => {
    window.localStorage.setItem('sirlocked.token', auth.token);
    window.localStorage.setItem('sirlocked.refreshToken', auth.refreshToken);
    window.localStorage.setItem('sirlocked.refreshExpiry', auth.refreshTokenExpiry);
    window.localStorage.setItem('sirlocked.user', JSON.stringify(auth.user));
    window.localStorage.setItem('sirlocked.uiLanguage', 'en');
    window.sessionStorage.setItem(`sirlocked.intro.${roomId}`, '1');
  }, { roomId, auth });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('#case-file-btn')).toBeVisible();
  return page;
}

async function runCrackLoop(investigator: Page, interrogator: Page) {
  await interrogator.locator('#case-file-btn').click();
  await interrogator.locator('[data-case-tab="testimony"]').click();
  await interrogator.locator('[data-v3-start-testimony="fragment-seal-intact-en"]').click();

  await investigator.locator('#case-file-btn').click();
  await expect(investigator.locator('[data-v3-propose-evidence="evidence-ticket-en"]')).toBeVisible();
  await investigator.locator('[data-v3-propose-evidence="evidence-ticket-en"]').click();
  await expect(interrogator.locator('.v3-joint-review')).toContainText('20:42 ticket stub');
  await expect(investigator.locator('.v3-joint-review')).toContainText('seal remained intact');

  await investigator.locator('[data-v3-confirm]').click();
  await expect(interrogator.locator('[data-v3-confirm]')).toBeVisible();
  await interrogator.locator('[data-v3-confirm]').click();
  await expect(interrogator.locator('.v3-crack-overlay.is-incorrect')).toBeVisible();
  await interrogator.locator('#v3-crack-dismiss').click();
  await expect(investigator.locator('.v3-crack-overlay.is-incorrect')).toBeVisible();
  await investigator.locator('#v3-crack-dismiss').click();

  await interrogator.locator('[data-v3-start-testimony="fragment-seal-intact-en"]').first().click();
  await investigator.locator('[data-case-tab="evidence"]').click();
  await expect(investigator.locator('[data-v3-propose-evidence="evidence-blue-wax-en"]')).toBeVisible();
  await investigator.locator('[data-v3-propose-evidence="evidence-blue-wax-en"]').click();
  await investigator.locator('[data-v3-confirm]').click();

  await interrogator.locator('[data-case-tab="testimony"]').click();
  await expect(interrogator.locator('[data-v3-edit-testimony="fragment-no-bag-en"]')).toBeVisible();
  await interrogator.locator('[data-v3-edit-testimony="fragment-no-bag-en"]').click();
  await expect(investigator.locator('.v3-confirmation-state')).toContainText('You');

  await interrogator.locator('[data-case-tab="contradictions"]').click();
  await interrogator.locator('[data-v3-edit-testimony="fragment-seal-intact-en"]').first().click();
  await investigator.reload();
  await expect(investigator.locator('#case-file-btn')).toBeVisible();
  await investigator.locator('#case-file-btn').click();
  await investigator.locator('[data-case-tab="contradictions"]').click();
  await expect(investigator.locator('.v3-joint-review')).toContainText('Overlapping blue wax');

  await expect(interrogator.locator('[data-v3-confirm]')).toBeVisible();
  await interrogator.locator('[data-v3-confirm]').click();
  await expect(investigator.locator('[data-v3-confirm]')).toBeVisible();
  await investigator.locator('[data-v3-confirm]').click();
  await expect(investigator.locator('.v3-crack-overlay.is-correct')).toContainText('CRACKED: THE SEAL WAS REPLACED');
  await expect(interrogator.locator('.v3-crack-overlay.is-correct')).toContainText('The archive was resealed');
}

async function assertWrongRoleErrorIsGeneric(api: APIRequestContext, roomId: string, investigatorToken: string) {
  const response = await rawCall(
    api,
    'POST',
    `/api/game/rooms/${roomId}/paired-confrontations`,
    investigatorToken,
    { attemptId: crypto.randomUUID(), testimonyFragmentId: 'fragment-seal-intact-en' },
  );
  expect(response.status).toBe(403);
  expect(response.text).not.toContain('fragment-seal-intact-en');
  expect(response.text).not.toContain('evidence-blue-wax-en');
}

async function call<T = unknown>(
  api: APIRequestContext,
  method: string,
  path: string,
  token?: string,
  data?: unknown,
): Promise<T> {
  const response = await rawCall(api, method, path, token, data);
  expect(response.status, `${method} ${path}: ${response.text}`).toBeGreaterThanOrEqual(200);
  expect(response.status, `${method} ${path}: ${response.text}`).toBeLessThan(300);
  return (JSON.parse(response.text) as { data: T }).data;
}

async function rawCall(
  api: APIRequestContext,
  method: string,
  path: string,
  token?: string,
  data?: unknown,
) {
  const response = await api.fetch(path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    data,
  });
  return { status: response.status(), text: await response.text() };
}
