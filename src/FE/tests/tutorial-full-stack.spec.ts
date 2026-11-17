import { expect, request, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Màn tân thủ against the real API and a seeded loopback MongoDB (tools/FullStackTestSeeder seeds it_newcomer,
 * an account that has not picked Kỳ cựu / Nhập môn yet):
 * the choice on the home screen, the gate on matchmaking, the solo room opened from /tan-thu with its coach,
 * the hand switch between Sherlock and Watson (tray tool and Q) that only the tutorial has, and a Crack the Lie
 * confirmed by the single player.
 *
 *   SIRLOCKED_RUN_TUTORIAL_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://localhost:5215 SIRLOCKED_TEST_PASSWORD=...
 *   SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 npx playwright test tests/tutorial-full-stack.spec.ts
 */
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string } };
const enabled = process.env.SIRLOCKED_RUN_TUTORIAL_FULL_STACK === 'true';

test('a newcomer picks Nhập môn, is sent to the tutorial and plays it alone', async ({ browser }) => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_TUTORIAL_FULL_STACK=true against a seeded loopback API.');
  test.setTimeout(300_000);
  const api = await request.newContext({ baseURL: process.env.SIRLOCKED_TEST_API_URL });
  const auth = await call<Auth>(api, 'POST', '/api/auth/login', undefined,
    { email: 'it_newcomer@tests.invalid', password: process.env.SIRLOCKED_TEST_PASSWORD });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ auth }) => {
    localStorage.setItem('sirlocked.token', auth.token);
    localStorage.setItem('sirlocked.refreshToken', auth.refreshToken);
    localStorage.setItem('sirlocked.refreshExpiry', auth.refreshTokenExpiry);
    localStorage.setItem('sirlocked.user', JSON.stringify(auth.user));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
  }, { auth });

  // 1. The home screen asks once; Nhập môn leads to the tutorial page.
  await page.goto('/menu');
  const choice = page.locator('[data-testid="tutorial-choice"]');
  await expect(choice).toBeVisible({ timeout: 30_000 });
  await choice.locator('[data-tt-path="BEGINNER"]').click();
  await expect(page).toHaveURL(/\/tan-thu$/);
  const status = await call<any>(api, 'GET', '/api/tutorial/status', auth.token);
  expect(status.path).toBe('BEGINNER');
  expect(status.required).toBe(true);

  // 2. Matchmaking and rooms are closed until the tutorial is finished.
  await page.goto('/find-game');
  await expect(page).toHaveURL(/\/tan-thu$/);
  const blocked = await api.fetch('/api/rooms', { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` }, data: { caseId: 'case-pixel-tram-hong-ngoc-vi' } });
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).errors.code).toBe('TUTORIAL_REQUIRED');

  // 3. The tutorial opens in a solo room with the coach instead of the role briefing.
  await page.locator('[data-tt-start]').click();
  await expect(page).toHaveURL(/\/game\//, { timeout: 30_000 });
  const roomId = page.url().split('/game/')[1];
  // The opening comic plays first when the cutscene is on: hold Esc to skip it, then close it.
  // isVisible() does not wait (its timeout is ignored), so on a slow machine the comic was not up yet and was never
  // skipped; waitFor() really waits for it.
  const shows = (locator: Locator) => locator.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false);
  if (await shows(page.locator('.mc-root'))) {
    await page.keyboard.down('Escape');
    await page.waitForTimeout(1200);
    await page.keyboard.up('Escape');
    const finish = page.locator('[data-mc-finish]');
    if (await shows(finish)) await finish.click();
  }
  const coach = page.locator('[data-testid="tutorial-coach"]');
  await expect(coach).toContainText('Chào thám tử mới', { timeout: 30_000 });
  await expect(page.locator('#intro-overlay')).toHaveCount(0);
  const state = () => call<any>(api, 'GET', `/api/game/rooms/${roomId}/state`, auth.token);
  expect((await state()).isTutorial).toBe(true);
  expect((await state()).players).toHaveLength(1);
  await coach.getByRole('button', { name: 'Bắt đầu' }).click();
  await expect(coach).toContainText('Chơi thử cả hai vai');
  await coach.getByRole('button', { name: 'Tiếp' }).click();
  await coach.getByRole('button', { name: 'Ẩn' }).click();

  // 4. The guestbook as Sherlock does nothing; the switch tool makes the player Watson, who then inspects it.
  await waitForScene(page);
  const guestbook = () => page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene')
    .pagePointOfRuntime({ x: 818, y: 1336 }));
  let point = await guestbook();
  // The real server must show Sherlock the guestbook in the tutorial, or the click falls through to the floor.
  expect((await state()).visibleScene.hotspots.map((hotspot: any) => hotspot.hotspotId)).toContain('hotspot-tt-so-khach');
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#toast-root')).toContainText('việc của Watson', { timeout: 30_000 });
  expect((await state()).players[0].role).toBe('INTERROGATOR');
  expect((await state()).unlockedClues.map((clue: any) => clue.clueId)).not.toContain('evidence-tt-so-khach');
  await page.locator('#tutorial-role-btn').click();
  await expect.poll(async () => (await state()).players[0].role, { timeout: 30_000 }).toBe('INVESTIGATOR');
  point = await guestbook();
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await state()).unlockedClues.map((clue: any) => clue.clueId), { timeout: 30_000 })
    .toContain('evidence-tt-so-khach');
  // Q switches back to Sherlock.
  await page.keyboard.press('q');
  await expect.poll(async () => (await state()).players[0].role, { timeout: 30_000 }).toBe('INTERROGATOR');

  // 5. One player is enough to confirm a Crack the Lie in the solo room.
  await call(api, 'POST', `/api/tutorial/rooms/${roomId}/role`, auth.token, { role: 'INTERROGATOR' });
  await call(api, 'POST', `/api/game/rooms/${roomId}/go-to-scene`, auth.token, { sceneId: 'scene-tt-ngo' });
  await call(api, 'POST', `/api/game/rooms/${roomId}/ask-dialogue`, auth.token, { dialogueId: 'dlg-tt-ham-chieu-nay' });
  const attemptId = randomUUID(); // the server only accepts UUID attempt ids
  const started = await call<any>(api, 'POST', `/api/game/rooms/${roomId}/paired-confrontations`, auth.token,
    { attemptId, testimonyFragmentId: 'frag-tt-ham-chua-vao' });
  const proposed = await call<any>(api, 'PUT', `/api/game/rooms/${roomId}/paired-confrontations/${attemptId}/evidence`, auth.token,
    { evidenceId: 'evidence-tt-so-khach', expectedRevision: started.revision });
  const confirmed = await call<any>(api, 'POST', `/api/game/rooms/${roomId}/paired-confrontations/${attemptId}/confirm`, auth.token,
    { expectedRevision: proposed.revision });
  expect(confirmed.isTerminal).toBe(true);
  expect((await state()).unlockedClues.map((clue: any) => clue.clueId)).toContain('reveal-tt-ham-o-tra-lau');

  // 6. Starting again resumes the same room.
  const resumed = await call<any>(api, 'POST', '/api/tutorial/start', auth.token, {});
  expect(resumed.roomId).toBe(roomId);
  expect(resumed.resumed).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

async function waitForScene(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as any).__sirlockedGame?.scene?.getScene('SirLockedPhaserScene');
    return Boolean(scene?.pagePointOfRuntime({ x: 0, y: 0 }));
  }), { timeout: 30_000 }).toBe(true);
}

async function call<T>(api: APIRequestContext, method: string, path: string, token?: string, data?: unknown): Promise<T> {
  const response = await api.fetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : undefined, data });
  const body = await response.text();
  expect(response.ok(), `${method} ${path}: ${body}`).toBe(true);
  return JSON.parse(body).data;
}
