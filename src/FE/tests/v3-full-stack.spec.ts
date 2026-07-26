import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

const enabled = process.env.SIRLOCKED_RUN_V3_FULL_STACK === 'true';
const password = process.env.SIRLOCKED_TEST_PASSWORD ?? '';
const apiBaseUrl = process.env.SIRLOCKED_TEST_API_URL ?? 'http://127.0.0.1:5215';

type Auth = {
  token: string;
  refreshToken: string;
  refreshTokenExpiry: string;
  user: { userId: string; fullName: string; role: string; isEmailVerified: boolean };
};

type Room = { roomId: string; roomCode: string };

test.describe('Crack V3 full-stack flow on the standard application host', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!enabled, 'Run through scripts/test-v3-full-stack.ps1 with a temporary integration database.');

  let api: APIRequestContext;
  let investigatorAuth: Auth;
  let interrogatorAuth: Auth;

  test.beforeAll(async () => {
    expect(password, 'The launcher must provide a process-only test password.').not.toBe('');
    api = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
    investigatorAuth = await login(api, 'it_investigator@tests.invalid');
    interrogatorAuth = await login(api, 'it_interrogator@tests.invalid');
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  for (const run of [1, 2, 3]) {
    test(`real HTTP/Auth/Mongo and two browser contexts complete V3 (run ${run})`, async ({ browser }) => {
      const room = await createStartedRoom(api, investigatorAuth, interrogatorAuth);
      await discoverPrivateKnowledge(api, room.roomId, investigatorAuth.token, interrogatorAuth.token);
      await assertServerPrivacy(api, room.roomId, investigatorAuth.token, interrogatorAuth.token);
      await assertWrongRoleErrorIsGeneric(api, room.roomId, investigatorAuth.token);

      const investigator = await openPlayer(browser, room.roomId, investigatorAuth);
      const interrogator = await openPlayer(browser, room.roomId, interrogatorAuth);
      try {
        await runCrackLoop(investigator, interrogator);
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
  await expect(investigator.locator('#accuse-btn')).toHaveCount(0);

  await interrogator.locator('[data-case-tab="testimony"]').click();
  await interrogator.locator('[data-v3-start-testimony="fragment-seal-intact-en"]').first().click();
  await investigator.locator('[data-case-tab="evidence"]').click();
  await expect(investigator.locator('[data-v3-propose-evidence="evidence-blue-wax-en"]')).toBeVisible();
  await investigator.locator('[data-v3-propose-evidence="evidence-blue-wax-en"]').click();
  await investigator.locator('[data-v3-confirm]').click();

  await interrogator.locator('[data-case-tab="testimony"]').click();
  await expect(interrogator.locator('[data-v3-edit-testimony="fragment-no-bag-en"]')).toBeVisible();
  await interrogator.locator('[data-v3-edit-testimony="fragment-no-bag-en"]').click();
  await expect(investigator.locator('.v3-confirmation-state')).toContainText('You');

  await interrogator.locator('[data-case-tab="testimony"]').click();
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
  await investigator.locator('#v3-crack-dismiss').click();
  await interrogator.locator('#v3-crack-dismiss').click();
  await expect(investigator.locator('#accuse-btn')).toHaveCount(0);

  await investigator.locator('[data-case-tab="contradictions"]').click();
  await investigator.locator('[data-solve-deduction="deduction-resealed-packet-en"][data-option="deduction-resealed-correct-en"]').click();
  await expect(investigator.locator('.deduction-card.is-solved')).toBeVisible();
  await expect(investigator.locator('#accuse-btn')).toBeVisible();
  await investigator.locator('.close-drawer-btn').click();

  await investigator.locator('#accuse-btn').click();
  await investigator.locator('[data-suspect="char-mara-en"]').click();
  await investigator.locator('#accuse-next').click();
  await investigator.locator('[data-motive="motive-alter-record-en"]').click();
  await investigator.locator('#accuse-next').click();
  await investigator.locator('[data-method="method-reseal-wax-en"]').click();
  await investigator.locator('#accuse-next').click();
  await assignAccusationEvidence(investigator, 'MOTIVE', 'evidence-ticket-en');
  await assignAccusationEvidence(investigator, 'METHOD', 'evidence-blue-wax-en');
  await assignAccusationEvidence(investigator, 'OPPORTUNITY', 'evidence-thread-en');
  await investigator.locator('#accuse-next').click();
  await investigator.locator('#accuse-confirm').click();

  // A V3 accusation is a proposal, not a verdict. Writing it counts as the author's confirmation,
  // so the case only closes once the Interrogator agrees to the same revision.
  await expect(investigator.locator('[data-accusation-attempt]')).toContainText('Mara Vale');
  await expect(investigator.locator('#accusation-confirm')).toBeDisabled();
  await expect(interrogator.locator('[data-accusation-attempt]')).toContainText('Mara Vale');
  await interrogator.locator('#accusation-confirm').click();

  await expect(interrogator).toHaveURL(/#\/result\//);
  await expect(investigator).toHaveURL(/#\/result\//);
  await expect(interrogator.locator('.result-banner')).toContainText('CASE CLOSED');
  await expect(investigator.locator('.result-banner')).toContainText('CASE CLOSED');
}

async function assignAccusationEvidence(page: Page, claimType: string, evidenceId: string) {
  await page.locator(`[data-claim-slot="${claimType}"]`).click();
  await page.locator(`[data-assign-evidence="${evidenceId}"]`).click();
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
