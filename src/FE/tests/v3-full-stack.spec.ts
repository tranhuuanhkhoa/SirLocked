import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

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
    test(`real HTTP/Auth/Mongo and two browser contexts complete V3 (run ${run})`, async ({ browser }, testInfo) => {
      test.skip(Boolean(process.env.SIRLOCKED_TEST_CASE_PATH), 'The supplied generated case uses the data-driven playtest.');
      const room = await createStartedRoom(api, investigatorAuth, interrogatorAuth);
      await discoverPrivateKnowledge(api, room.roomId, investigatorAuth.token, interrogatorAuth.token);
      await assertServerPrivacy(api, room.roomId, investigatorAuth.token, interrogatorAuth.token);
      await assertWrongRoleErrorIsGeneric(api, room.roomId, investigatorAuth.token);

      const investigator = await openPlayer(browser, room.roomId, investigatorAuth);
      const interrogator = await openPlayer(browser, room.roomId, interrogatorAuth);
      try {
        await runCrackLoop(investigator, interrogator);
        if (run === 1) {
          await expect(investigator.locator('#toast-root .toast')).toHaveCount(0);
          await expect(interrogator.locator('#toast-root .toast')).toHaveCount(0);
          await investigator.screenshot({ path: testInfo.outputPath('investigator-case-closed.png'), fullPage: true });
          await interrogator.screenshot({ path: testInfo.outputPath('interrogator-case-closed.png'), fullPage: true });
        }
      } finally {
        // A timeout can already have disposed a context. Cleanup must not hide
        // the original failed gameplay assertion or skip the partner's cleanup.
        await Promise.allSettled([investigator.context().close(), interrogator.context().close()]);
      }
    });
  }

  test('supplied case reaches a winning accusation with two real browsers and all authored requirements', async ({ browser }, testInfo) => {
    test.skip(!process.env.SIRLOCKED_TEST_CASE_PATH, 'Supply -CaseJsonPath to the launcher for an isolated generated-case playtest.');
    test.setTimeout(120_000);
    const fixture = JSON.parse(await readFile(process.env.SIRLOCKED_TEST_CASE_PATH!, 'utf8'));
    const room = await createStartedRoom(api, investigatorAuth, interrogatorAuth, fixture.caseId);
    const investigator = await openPlayer(browser, room.roomId, investigatorAuth);
    const interrogator = await openPlayer(browser, room.roomId, interrogatorAuth);
    try {
      await gatherSuppliedCase(api, room.roomId, fixture, investigator, investigatorAuth.token, interrogatorAuth.token);
      const getState = (token: string) => call<any>(api, 'GET', `/api/game/rooms/${room.roomId}/state`, token);
      const investigatorState = await getState(investigatorAuth.token);
      const interrogatorState = await getState(interrogatorAuth.token);
      expect(investigatorState.solvedPuzzleIds, 'Every REQUIRED puzzle must be solved through the gameplay API.').toEqual(expect.arrayContaining(
        fixture.puzzles.filter((puzzle: any) => puzzle.progressionRole === 'REQUIRED').map((puzzle: any) => puzzle.puzzleId),
      ));
      expect(investigatorState.privateEvidence.length).toBeGreaterThanOrEqual(3);
      expect(interrogatorState.privateTestimonies.length).toBeGreaterThanOrEqual(2);
      expect(investigatorState.privateTestimonies).toEqual([]);
      expect(interrogatorState.privateEvidence).toEqual([]);
      await investigator.screenshot({ path: testInfo.outputPath('generated-case-investigator-discovery.png'), fullPage: true });

      for (const challenge of fixture.evidenceChallenges) {
        await ensureDrawer(interrogator, 'testimony');
        await interrogator.locator(`[data-v3-start-testimony="${challenge.testimonyFragmentId}"]`).first().click();
        await ensureDrawer(investigator, 'evidence');
        await investigator.locator(`[data-v3-propose-evidence="${challenge.correctEvidenceId}"]`).click();
        await expect(interrogator.locator('.v3-joint-review')).toBeVisible();
        await investigator.locator('[data-v3-confirm]').click();
        await interrogator.locator('[data-v3-confirm]').click();
        await expect(investigator.locator('.v3-crack-overlay.is-correct')).toBeVisible();
        await expect(interrogator.locator('.v3-crack-overlay.is-correct')).toBeVisible();
        await investigator.screenshot({ path: testInfo.outputPath(`generated-case-${challenge.challengeId}-cracked.png`), fullPage: true });
        await investigator.locator('#v3-crack-dismiss').click();
        await interrogator.locator('#v3-crack-dismiss').click();
      }
      for (const deduction of fixture.deductions) {
        await ensureDrawer(investigator, 'contradictions');
        await investigator.locator(`[data-solve-deduction="${deduction.deductionId}"][data-option="${deduction.correctOptionId}"]`).click();
        await expect.poll(async () => (await getState(investigatorAuth.token)).solvedDeductions.some((entry: any) => entry.deductionId === deduction.deductionId)).toBe(true);
      }
      await expect(investigator.locator('#accuse-btn')).toBeVisible();
      if (await investigator.locator('.close-drawer-btn').isVisible()) await investigator.locator('.close-drawer-btn').click();
      await investigator.locator('#accuse-btn').click();
      await investigator.locator(`[data-suspect="${fixture.finalLogic.culpritId}"]`).click();
      await investigator.locator('#accuse-next').click();
      await investigator.locator(`[data-motive="${fixture.finalLogic.correctMotiveId}"]`).click();
      await investigator.locator('#accuse-next').click();
      await investigator.locator(`[data-method="${fixture.finalLogic.correctMethodId}"]`).click();
      await investigator.locator('#accuse-next').click();
      for (const link of fixture.finalLogic.requiredEvidenceLinks)
        await assignAccusationEvidence(investigator, link.claimType, link.evidenceId);
      await investigator.locator('#accuse-next').click();
      await investigator.locator('#accuse-confirm').click();
      await expect(investigator.locator('#accusation-confirm')).toBeDisabled();
      await expect(interrogator.locator('#accusation-confirm')).toBeEnabled();
      await interrogator.locator('#accusation-confirm').click();
      await expect(investigator).toHaveURL(/#\/result\//);
      await expect(interrogator).toHaveURL(/#\/result\//);
      await expect(investigator.locator('.result-banner')).toContainText('CASE CLOSED');
      await expect(interrogator.locator('.result-banner')).toContainText('CASE CLOSED');
      await expect(investigator.locator('#toast-root .toast')).toHaveCount(0);
      await expect(interrogator.locator('#toast-root .toast')).toHaveCount(0);
      await investigator.screenshot({ path: testInfo.outputPath('generated-case-investigator-won.png'), fullPage: true });
      await interrogator.screenshot({ path: testInfo.outputPath('generated-case-interrogator-won.png'), fullPage: true });
      await testInfo.attach('generated-case-playtest-summary', { contentType: 'application/json', body: JSON.stringify({
        caseId: fixture.caseId, scenes: fixture.stages.flatMap((stage: any) => stage.scenes).length,
        challenges: fixture.evidenceChallenges.length, deductions: fixture.deductions.length,
        requiredPuzzles: fixture.puzzles.filter((puzzle: any) => puzzle.progressionRole === 'REQUIRED').length,
        requiredFinalClaims: fixture.finalLogic.requiredEvidenceLinks.length,
        twoPlayerConsensus: true, finalResult: 'CASE CLOSED', providerCalls: 0,
        note: 'Uses production deterministic placeholder layout; verifies runtime solvability with authored answers, not image quality or independent human reasoning.'
      }, null, 2) });
    } finally {
      await Promise.allSettled([investigator.context().close(), interrogator.context().close()]);
    }
  });

  test('real SignalR reconnect keeps the match, then the five-minute worker expires an offline partner', async ({ browser }, testInfo) => {
    const caseId = process.env.SIRLOCKED_TEST_CASE_PATH
      ? JSON.parse(await readFile(process.env.SIRLOCKED_TEST_CASE_PATH, 'utf8')).caseId
      : 'case-v3-broken-seal-en';
    const room = await createStartedRoom(api, investigatorAuth, interrogatorAuth, caseId);
    const investigator = await openPlayer(browser, room.roomId, investigatorAuth);
    let interrogator = await openPlayer(browser, room.roomId, interrogatorAuth);
    const readRoom = () => call<{ status: string; players: { userId: string; isConnected: boolean; reconnectGraceEndsAt?: string }[] }>(api, 'GET', `/api/rooms/${room.roomId}`, investigatorAuth.token);
    try {
      await expect.poll(async () => (await readRoom()).players.every((player) => player.isConnected)).toBe(true);
      await interrogator.context().close();
      await expect(investigator.locator('#game-reconnect-countdown')).toBeVisible();
      const disconnected = (await readRoom()).players.find((player) => player.userId === interrogatorAuth.user.userId)!;
      const remaining = Date.parse(disconnected.reconnectGraceEndsAt!) - Date.now();
      expect(remaining).toBeGreaterThan(280_000);
      expect(remaining).toBeLessThanOrEqual(300_000);
      await investigator.screenshot({ path: testInfo.outputPath('real-signalr-reconnect-countdown.png'), fullPage: true });

      interrogator = await openPlayer(browser, room.roomId, interrogatorAuth);
      await expect(investigator.locator('#game-reconnect-wait')).toHaveCount(0);
      await expect.poll(async () => (await readRoom()).players.every((player) => player.isConnected)).toBe(true);
      expect((await readRoom()).status).toBe('IN_PROGRESS');

      await interrogator.context().close();
      await expect(investigator.locator('#game-reconnect-countdown')).toBeVisible();
      const seeder = process.env.SIRLOCKED_TEST_SEEDER_DLL!;
      expect(seeder).toBeTruthy();
      await promisify(execFile)('dotnet', [seeder, 'age-disconnect', process.env.SIRLOCKED_TEST_MONGO!, process.env.SIRLOCKED_TEST_DATABASE!, room.roomId, interrogatorAuth.user.userId], { windowsHide: true });
      // No client abandon request: the normal hosted worker must persist the terminal
      // state and push a SignalR update to the remaining browser itself.
      await expect(investigator.getByRole('heading', { name: 'Room ended', exact: true })).toBeVisible({ timeout: 15_000 });
      expect((await readRoom()).status).toBe('ABANDONED');
      await investigator.screenshot({ path: testInfo.outputPath('real-worker-room-ended.png'), fullPage: true });
      interrogator = await openEndedPlayer(browser, room.roomId, interrogatorAuth);
      await expect(interrogator.getByRole('heading', { name: 'Room ended', exact: true })).toBeVisible();
      expect((await readRoom()).status).toBe('ABANDONED');
    } finally {
      await Promise.allSettled([investigator.context().close(), interrogator.context().close()]);
    }
  });
});

async function ensureDrawer(page: Page, tab: string) {
  if (!(await page.locator('.case-file-drawer').isVisible())) await page.locator('#case-file-btn').click();
  await page.locator(`[data-case-tab="${tab}"]`).click();
}

async function gatherSuppliedCase(api: APIRequestContext, roomId: string, fixture: any, investigator: Page, investigatorToken: string, interrogatorToken: string) {
  const prefix = `/api/game/rooms/${roomId}`;
  const state = (token: string) => call<any>(api, 'GET', `${prefix}/state`, token);
  const scenes = fixture.stages.sort((a: any, b: any) => a.order - b.order).flatMap((stage: any) => stage.scenes);
  // Rich cases may unlock a document in a later scene that is compared at an
  // earlier desk. Revisit normal unlocked routes until no acquisition changes.
  const maximumRounds = fixture.puzzles.length + fixture.interactions.length + fixture.clues.length + 1;
  for (let round = 0; round < maximumRounds; round++) {
    let roundChanged = false;
    for (const scene of scenes) {
      for (const token of [investigatorToken, interrogatorToken])
        await call(api, 'POST', `${prefix}/go-to-scene`, token, { sceneId: scene.sceneId });
      // Read each role's actual visible state and perform normal game endpoints. No
      // gameplay DB writes, unlocked-state injection, network mocks or provider calls.
      const maximumPasses = fixture.items.length + fixture.clues.length + fixture.dialogues.length + fixture.interactions.length + fixture.puzzles.length + 1;
      for (let pass = 0; pass < maximumPasses; pass++) {
        let changed = false;
        let current = await state(investigatorToken);
        for (const item of current.visibleScene.items.filter((entry: any) => !entry.isInspected)) {
          const hotspot = current.visibleScene.hotspots.find((entry: any) => entry.targetId === item.itemId);
          if (hotspot?.isLocked) continue;
          await call(api, 'POST', `${prefix}/inspect-item`, investigatorToken, { itemId: item.itemId });
          changed = true;
        }
        current = await state(investigatorToken);
        for (const zone of current.visibleScene.runtime?.clueZones ?? []) {
          if (current.capturedClueIds.includes(zone.clueId) || zone.requiredClueIds.some((id: string) => !current.unlockedClueIds.includes(id))) continue;
          const canvas = investigator.locator('canvas').first();
          await expect(canvas).toBeVisible();
          const photo = await canvas.screenshot({ type: 'jpeg', quality: 70 });
          const response = await api.post(`${prefix}/capture-clue`, {
            headers: { Authorization: `Bearer ${investigatorToken}` },
            multipart: {
              SceneId: scene.sceneId,
              'CaptureRect.X': String(zone.bounds.x), 'CaptureRect.Y': String(zone.bounds.y),
              'CaptureRect.Width': String(zone.bounds.width), 'CaptureRect.Height': String(zone.bounds.height),
              Photo: { name: 'browser-scene.jpg', mimeType: 'image/jpeg', buffer: photo },
            },
          });
          const result = await response.json();
          expect(response.ok(), JSON.stringify(result)).toBe(true);
          expect(result.data.captureResult).toBe('HIT');
          changed = true;
        }
        current = await state(investigatorToken);
        for (const interaction of fixture.interactions) {
          if (current.usedInteractionIds.includes(interaction.interactionId)) continue;
          if (!interaction.requiredClueIds.every((id: string) => current.unlockedClueIds.includes(id))) continue;
          if (!interaction.requiredItemIds.every((id: string) => current.collectedItemIds.includes(id))) continue;
          if (interaction.targetId && ![...scene.itemIds, ...scene.characterIds, ...scene.hotspots.map((hotspot: any) => hotspot.targetId), scene.sceneId].includes(interaction.targetId)) continue;
          const endpoint = interaction.type === 'INSPECT_ENVIRONMENT' ? `interactions/${interaction.interactionId}/activate`
            : interaction.type === 'COMBINE_ITEMS' ? 'combine-items' : 'use-item';
          const data = interaction.type === 'COMBINE_ITEMS' ? { itemIds: interaction.requiredItemIds }
            : interaction.type === 'USE_ITEM_ON_TARGET' ? { itemId: interaction.requiredItemIds[0], targetId: interaction.targetId } : undefined;
          await call(api, 'POST', `${prefix}/${endpoint}`, investigatorToken, data);
          changed = true;
        }
        current = await state(investigatorToken);
        for (const puzzle of fixture.puzzles) {
          if (current.solvedPuzzleIds.includes(puzzle.puzzleId) || ![...scene.itemIds, ...scene.characterIds, scene.sceneId].includes(puzzle.targetId)) continue;
          if (!puzzle.requiredClueIds.every((id: string) => current.unlockedClueIds.includes(id)) || !puzzle.requiredItemIds.every((id: string) => current.collectedItemIds.includes(id))) continue;
          await call(api, 'POST', `${prefix}/solve-puzzle`, investigatorToken, { puzzleId: puzzle.puzzleId, answer: puzzle.correctCode, answerSequence: puzzle.correctSequence });
          changed = true;
        }
        const partner = await state(interrogatorToken);
        for (const dialogue of partner.visibleScene.availableDialogues.filter((entry: any) => !entry.isAsked && !entry.isLocked)) {
          await call(api, 'POST', `${prefix}/ask-dialogue`, interrogatorToken, { dialogueId: dialogue.dialogueId });
          changed = true;
        }
        roundChanged ||= changed;
        if (!changed) break;
      }
      await call(api, 'POST', `${prefix}/complete-scene`, investigatorToken);
      await call(api, 'POST', `${prefix}/complete-scene`, interrogatorToken);
    }
    if (!roundChanged) break;
  }
}

async function login(api: APIRequestContext, email: string): Promise<Auth> {
  return call<Auth>(api, 'POST', '/api/auth/login', undefined, { email, password });
}

async function createStartedRoom(api: APIRequestContext, investigator: Auth, interrogator: Auth, caseId = 'case-v3-broken-seal-en'): Promise<Room> {
  const room = await call<Room>(
    api,
    'POST',
    '/api/rooms',
    investigator.token,
    { caseId },
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
  const page = await openEndedPlayer(browser, roomId, auth);
  await expect(page.locator('#case-file-btn')).toBeVisible();
  return page;
}

async function openEndedPlayer(browser: Browser, roomId: string, auth: Auth): Promise<Page> {
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
