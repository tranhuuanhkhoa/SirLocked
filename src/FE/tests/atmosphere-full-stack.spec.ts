import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * VUAN-4 on a real local stack (loopback API + MongoDB, throwaway database): the sample case
 * "Đồng hồ bỏ túi đêm mưa" and the weather copy of "Lọ thuốc thứ Năm" are imported as DRAFTS and every new field
 * (voices, music, weather, indoor, time of day) survives the import. To open a room the server needs a published
 * case, so the sample is published in this throwaway database only, never anywhere else. Then two detectives play:
 * the clock shop has its own song and no rain, the harbour has rain and another song, three witnesses blip differently.
 *
 *   SIRLOCKED_RUN_ATMOSPHERE_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://127.0.0.1:5231
 *   SIRLOCKED_TEST_ADMIN_EMAIL=... SIRLOCKED_TEST_ADMIN_PASSWORD=... SIRLOCKED_TEST_PASSWORD=<12+ chars>
 *   SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5232
 *   npx playwright test tests/atmosphere-full-stack.spec.ts
 */
type Json = Record<string, any>;
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string } };
const enabled = process.env.SIRLOCKED_RUN_ATMOSPHERE_FULL_STACK === 'true';
const apiUrl = process.env.SIRLOCKED_TEST_API_URL ?? '';
const readJson = (file: string) => JSON.parse(readFileSync(path.resolve(file), 'utf8')) as Json;
const SHOP = 'scene-dh-tiem-dong-ho', DOCK = 'scene-dh-ben-cang';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

test('sample case imported as a draft keeps its atmosphere; shop and harbour sound and look as authored', async ({ browser }) => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_ATMOSPHERE_FULL_STACK=true against a loopback API.');
  expect(['127.0.0.1', 'localhost'], 'only a loopback API').toContain(new URL(apiUrl).hostname);
  test.setTimeout(600_000);
  const api = await request.newContext({ baseURL: apiUrl });
  const admin = await call<Auth>(api, 'POST', '/api/auth/admin/login', undefined,
    { email: process.env.SIRLOCKED_TEST_ADMIN_EMAIL, password: process.env.SIRLOCKED_TEST_ADMIN_PASSWORD });

  // Run it on a fresh database: a room of an earlier run keeps the case locked against re-import.
  const inv = await player(api, 'atmo_investigator@tests.invalid', 'Điều tra thử');
  const int = await player(api, 'atmo_interrogator@tests.invalid', 'Thẩm vấn thử');

  // ---- import as drafts; the fields survive
  const sample = readJson('../BE/Tests/Fixtures/case-pixel-dong-ho-dem-mua-vi.json');
  const copy = readJson('tests/fixtures/case-pixel-thoi-tiet-thu-vi.json');
  for (const caseJson of [sample, copy]) {
    await call(api, 'POST', '/api/admin/cases/import-json', admin.token, { caseJson, overwrite: true });
    const stored = await call<Json>(api, 'GET', `/api/admin/cases/${caseJson.caseId}`, admin.token);
    expect(stored.status).toBe('DRAFT');
    for (const character of caseJson.characters.filter((entry: Json) => entry.voice)) {
      expect(stored.characters.find((entry: Json) => entry.characterId === character.characterId).voice).toEqual(character.voice);
    }
    for (const scene of caseJson.stages.flatMap((stage: Json) => stage.scenes)) {
      const runtime = stored.stages.flatMap((stage: Json) => stage.scenes).find((entry: Json) => entry.sceneId === scene.sceneId).runtime;
      expect(runtime.weather).toEqual(scene.runtime.weather);
      expect(runtime.indoor).toBe(scene.runtime.indoor);
      expect(runtime.timeOfDay).toBe(scene.runtime.timeOfDay);
      if (scene.runtime.audio?.music) expect(runtime.audio.music).toMatchObject({ url: scene.runtime.audio.music.url, loopEndSec: scene.runtime.audio.music.loopEndSec });
    }
  }
  const published = await call<Json[]>(api, 'GET', '/api/cases/published', admin.token);
  expect(published.map((entry) => entry.caseId)).not.toContain(sample.caseId);

  // ---- a room needs a published case: publish in this throwaway database only
  await call(api, 'PATCH', `/api/admin/cases/${sample.caseId}/publish`, admin.token);
  const room = await call<Json>(api, 'POST', '/api/rooms', inv.token, { caseId: sample.caseId });
  await call(api, 'POST', '/api/rooms/join', int.token, { roomCode: room.roomCode });
  for (const [auth, role] of [[inv, 'INVESTIGATOR'], [int, 'INTERROGATOR']] as const) {
    await call(api, 'POST', `/api/rooms/${room.roomId}/select-role`, auth.token, { role });
    await call(api, 'POST', `/api/rooms/${room.roomId}/ready`, auth.token, { isReady: true });
  }
  await call(api, 'POST', `/api/rooms/${room.roomId}/start`, inv.token);

  const errors: string[] = [];
  const page = await openPlayer(browser, int, room.roomId, errors);
  const investigator = await openPlayer(browser, inv, room.roomId, errors);
  for (const each of [page, investigator]) {
    if (await each.locator('#intro-dismiss').isVisible().catch(() => false)) await each.locator('#intro-dismiss').click();
  }
  await page.keyboard.press('Shift');
  await expect.poll(async () => (await audio(page)).contextState, { timeout: 20_000 }).toBe('running');

  // ---- the clock shop: indoors, its own song, no weather
  await expect.poll(async () => (await state(page))?.currentSceneId, { timeout: 30_000 }).toBe(SHOP);
  await expect.poll(async () => (await audio(page)).music.playing ?? '', { timeout: 30_000 }).toContain('/hang-duong/tiem-hop-nhac.ogg');
  expect(await weather(page)).toMatchObject({ type: 'NONE', particles: 0, indoor: true });
  expect((await audio(page)).weather.running).toBe(false);
  const shopkeeper = await askFirst(page, 'char-dh-ong-tu');

  // ---- the harbour: rain (picture and sound) and the harbour song
  await goTo(page, DOCK);
  await expect.poll(async () => (await weather(page)).particles, { timeout: 20_000 }).toBeGreaterThan(20);
  expect(await weather(page)).toMatchObject({ type: 'RAIN', intensity: 0.7, indoor: false });
  await expect.poll(async () => (await audio(page)).weather.running).toBe(true);
  await expect.poll(async () => (await audio(page)).music.playing ?? '', { timeout: 30_000 }).toContain('/hang-duong/ben-cang-dem-mua.ogg');
  const florist = await askFirst(page, 'char-dh-co-hanh');
  const sailor = await askFirst(page, 'char-dh-anh-bay');

  // ---- back inside: the rain stops at once, the shop song returns
  await goTo(page, SHOP);
  await expect.poll(async () => (await weather(page)).active).toBe(false);
  await expect.poll(async () => (await audio(page)).weather.running).toBe(false);
  await expect.poll(async () => (await audio(page)).music.playing ?? '', { timeout: 30_000 }).toContain('/hang-duong/tiem-hop-nhac.ogg');

  const waveOf = (snapshot: Json, characterId: string) => snapshot.blips.recent.find((blip: Json) => blip.characterId === characterId)?.wave;
  expect([waveOf(shopkeeper, 'char-dh-ong-tu'), waveOf(florist, 'char-dh-co-hanh'), waveOf(sailor, 'char-dh-anh-bay')])
    .toEqual(['triangle', 'sine', 'square']);
  await page.screenshot({ path: test.info().outputPath('shop-after.png') });
  expect(errors).toEqual([]);
  await api.dispose();
});

async function call<T = Json>(api: APIRequestContext, method: string, url: string, token?: string, data?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await api.fetch(url, { method, headers: token ? { Authorization: `Bearer ${token}` } : undefined, data });
    const body = await response.text();
    // Sign-in and sign-up are rate limited: wait a minute and retry.
    if (response.status() === 429) { await new Promise((resolve) => setTimeout(resolve, 65_000)); continue; }
    expect(response.ok(), `${method} ${url}: ${body.slice(0, 500)}`).toBe(true);
    return (body ? JSON.parse(body).data : undefined) as T;
  }
  throw new Error(`${method} ${url}: still rate limited`);
}

async function player(api: APIRequestContext, email: string, fullName: string): Promise<Auth> {
  const password = process.env.SIRLOCKED_TEST_PASSWORD;
  const login = await api.fetch('/api/auth/login', { method: 'POST', data: { email, password } });
  if (login.ok()) return JSON.parse(await login.text()).data;
  return call<Auth>(api, 'POST', '/api/auth/register', undefined, { fullName, email, password });
}

async function openPlayer(browser: Browser, auth: Auth, roomId: string, errors: string[]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  // The local stack keeps playtest telemetry off, so the game's telemetry posts answer 409 there; that is not ours.
  const telemetry = (url: string) => url.includes('/playtest-events');
  page.on('console', (message) => { if (message.type() === 'error' && !telemetry(message.location().url)) errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', async (response) => {
    if (response.status() >= 400 && !telemetry(response.url())) errors.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname} ${(await response.text().catch(() => '')).slice(0, 200)}`);
  });
  await page.addInitScript(({ auth }) => {
    localStorage.setItem('sirlocked.token', auth.token);
    localStorage.setItem('sirlocked.refreshToken', auth.refreshToken);
    localStorage.setItem('sirlocked.refreshExpiry', auth.refreshTokenExpiry);
    localStorage.setItem('sirlocked.user', JSON.stringify(auth.user));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
  }, { auth });
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  return page;
}

const weather = (page: Page) => page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').weatherState());
const audio = (page: Page) => page.evaluate(() => (window as any).__sirlockedAudio?.inspect() ?? { contextState: 'none' });
const state = (page: Page) => page.evaluate(() => (window as any).__sirlockedTest?.state());
async function goTo(page: Page, sceneId: string) {
  await page.evaluate((id) => (window as any).__sirlockedTest.goToScene(id), sceneId);
  await expect.poll(async () => (await state(page))?.currentSceneId, { timeout: 30_000 }).toBe(sceneId);
}
async function askFirst(page: Page, characterId: string) {
  await page.evaluate((id) => (window as any).__sirlockedTest.talkTo(id), characterId);
  const choice = page.locator('.conversation-choices button:not(:disabled)').first();
  await expect(choice).toBeVisible({ timeout: 20_000 });
  await choice.click();
  const speaking = page.locator('.vn-overlay.is-npc-speaking');
  for (let i = 0; i < 10 && !(await speaking.count()); i++) {
    await page.waitForTimeout(350);
    if (await speaking.count()) break;
    await page.locator('[data-vn-advance]').click().catch(() => undefined);
  }
  await expect.poll(async () => (await audio(page)).blips.recent.filter((blip: Json) => blip.characterId === characterId).length,
    { timeout: 20_000 }).toBeGreaterThan(3);
  const snapshot = await audio(page);
  await page.keyboard.press('Escape');
  return snapshot;
}
