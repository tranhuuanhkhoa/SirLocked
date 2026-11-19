import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * Two detectives solve the PixelLab case "Lọ thuốc thứ Năm" in pixel render mode:
 * a scrolling outdoor map, five interiors entered through doors, 8-way characters,
 * and every V3 mechanic (camera clue, inspect, use item, combine, code + sequence puzzles,
 * branching conversations, two Crack-the-Lie pairs, two deductions, final accusation).
 *
 * Run against a loopback MongoDB seeded by tools/FullStackTestSeeder:
 *   SIRLOCKED_RUN_PIXEL_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://localhost:5215
 *   SIRLOCKED_TEST_PASSWORD=... SIRLOCKED_TEST_CASE_PATH=../BE/SeedData/V3/case-pixel-lo-thuoc-thu-nam-vi.json
 *   SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 npx playwright test tests/pixel-case-full-stack.spec.ts
 */
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string } };
type Box = { x: number; y: number; width: number; height: number };
const enabled = process.env.SIRLOCKED_RUN_PIXEL_FULL_STACK === 'true';
const S = (key: string) => `scene-px-${key}`;

test('two detectives solve the pixel case through doors, scrolling scenes and every mechanic', async ({ browser }, testInfo) => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_PIXEL_FULL_STACK=true against a seeded loopback API.');
  test.setTimeout(900_000);
  const fixture = JSON.parse(await readFile(process.env.SIRLOCKED_TEST_CASE_PATH!, 'utf8'));
  const api = await request.newContext({ baseURL: process.env.SIRLOCKED_TEST_API_URL });
  const pages: Page[] = [];
  const failures: string[] = [];
  let shot = 0;
  const step = (label: string) => console.log(`[pixel-e2e] ${new Date().toISOString().slice(11, 19)} ${label}`);
  const capture = async (page: Page, name: string) => {
    await settle(page);
    await page.screenshot({ path: testInfo.outputPath(`${String(++shot).padStart(2, '0')}-${name}.png`) });
  };
  try {
    const invAuth = await login(api, 'it_investigator@tests.invalid');
    const intAuth = await login(api, 'it_interrogator@tests.invalid');
    const room = await call<any>(api, 'POST', '/api/rooms', invAuth.token, { caseId: fixture.caseId });
    await call(api, 'POST', '/api/rooms/join', intAuth.token, { roomCode: room.roomCode });
    for (const [auth, role] of [[invAuth, 'INVESTIGATOR'], [intAuth, 'INTERROGATOR']] as const) {
      await call(api, 'POST', `/api/rooms/${room.roomId}/select-role`, auth.token, { role });
      await call(api, 'POST', `/api/rooms/${room.roomId}/ready`, auth.token, { isReady: true });
    }
    await call(api, 'POST', `/api/rooms/${room.roomId}/start`, invAuth.token);
    const inv = await openPlayer(browser, invAuth, room.roomId);
    const int = await openPlayer(browser, intAuth, room.roomId);
    pages.push(inv, int);
    for (const page of pages) page.on('pageerror', (error) => failures.push(error.message));
    for (const page of pages) await page.locator('#intro-dismiss').click();
    await Promise.all(pages.map(waitForSceneInput));
    const invState = () => call<any>(api, 'GET', `/api/game/rooms/${room.roomId}/state`, invAuth.token);
    const intState = () => call<any>(api, 'GET', `/api/game/rooms/${room.roomId}/state`, intAuth.token);

    step('pixel renderer contract');
    // ---- pixel renderer contract on the outdoor map
    const hub = await renderer(inv);
    expect(hub.mode).toBe('pixel');
    expect(hub.gridCells).toBeGreaterThan(1000);
    expect(hub.nativePixel % 1).toBe(0);
    await capture(inv, 'hub-investigator');
    await capture(int, 'hub-interrogator');
    // Keyboard walking turns the player and scrolls the camera.
    const startPose = await pose(inv);
    await holdKey(inv, 'ArrowLeft', 700);
    const afterWalk = await pose(inv);
    expect(afterWalk.x).toBeLessThan(startPose.x);
    expect(['west', 'north-west', 'south-west']).toContain(afterWalk.facing);
    await expect.poll(async () => (await renderer(int)).remote?.facing).toBeTruthy();

    step('scene 1');
    // ---- scene 1: the housekeeper at the gate
    await askAll(int, 'char-px-ly-hanh', intState);
    await expect.poll(async () => (await intState()).currentSceneCanComplete).toBe(true);
    // The investigator walks to the now-open door of nhà số 7; the interrogator uses Continue.
    await useDoor(inv, S('nha-so-7'));
    await expect.poll(async () => (await invState()).currentSceneId, { timeout: 30_000 }).toBe(S('nha-so-7'));
    await clickContinue(int);
    await expect.poll(async () => (await intState()).currentSceneId, { timeout: 30_000 }).toBe(S('nha-so-7'));
    await waitForSceneInput(inv);
    const room7 = await renderer(inv);
    expect(room7.projection).toBe('isometric');
    expect(room7.nativePixel).toBeLessThan(hub.nativePixel);
    await capture(inv, 'nha-so-7-investigator');

    step('scene 2');
    // ---- scene 2: nhà số 7
    for (const itemId of ['item-px-lo-thu-nam', 'item-px-kinh-lup', 'item-px-hop-nu-trang']) {
      await inspect(inv, itemId, invState);
    }
    await inspectEnvironment(inv, 'interaction-px-ngan-keo', invState);
    await photograph(inv, 'evidence-px-tem-niem', invState);
    await useItemOn(inv, 'item-px-kinh-lup', 'item-px-lo-thu-nam', 'evidence-px-keo-la', invState);
    await converse(int, 'char-px-lam-the-bao', ['choice-px-bao-thu-hai', 'choice-px-bao-thu-nam'], intState);
    await capture(int, 'nha-so-7-interrogator');
    await solveCode(inv, 'item-px-tu-kinh', '2100', 'puzzle-px-tu-kinh', invState);
    await expect.poll(async () => (await invState()).currentSceneCanComplete).toBe(true);
    for (const page of pages) await clickContinue(page);
    await expect.poll(async () => (await invState()).currentSceneId, { timeout: 30_000 }).toBe(S('hieu-thuoc'));
    await expect.poll(async () => (await intState()).currentSceneId, { timeout: 30_000 }).toBe(S('hieu-thuoc'));

    step('scene 3');
    // ---- scene 3: hiệu thuốc + first Crack (Bảo lied about the pick-up time)
    await inspect(inv, 'item-px-so-giao-nhan', invState);
    await inspect(inv, 'item-px-khay-tem', invState);
    await askAll(int, 'char-px-hoc-viec', intState);
    await capture(inv, 'hieu-thuoc-investigator');
    await crack(inv, int, fixture.evidenceChallenges[0], invState, true);
    for (const page of pages) await clickContinue(page);
    await expect.poll(async () => (await invState()).currentSceneId, { timeout: 30_000 }).toBe(S('nha-xe'));
    await expect.poll(async () => (await intState()).currentSceneId, { timeout: 30_000 }).toBe(S('nha-xe'));

    step('scene 4');
    // ---- scene 4: nhà xe
    await inspect(inv, 'item-px-so-xe', invState);
    await inspectEnvironment(inv, 'interaction-px-ruong', invState);
    await converse(int, 'char-px-trinh-luc', ['choice-px-luc-dem', 'choice-px-luc-thu-hai'], intState);
    await capture(int, 'nha-xe-interrogator');
    for (const page of pages) await clickContinue(page);
    await expect.poll(async () => (await invState()).currentSceneId, { timeout: 30_000 }).toBe(S('cam-do'));
    await expect.poll(async () => (await intState()).currentSceneId, { timeout: 30_000 }).toBe(S('cam-do'));

    step('scene 5');
    // ---- scene 5: tiệm cầm đồ + second Crack (Lực never saw the ring)
    await inspect(inv, 'item-px-so-no', invState);
    await inspect(inv, 'item-px-phieu-cam', invState);
    await photograph(inv, 'evidence-px-nhan-trong-tu', invState);
    await askAll(int, 'char-px-dang-buu', intState);
    await capture(inv, 'cam-do-investigator');
    await crack(inv, int, fixture.evidenceChallenges[1], invState, false);
    // The interrogator walks back to the carriage house through the street for Lực's confession.
    await travel(int, [S('pho'), S('nha-xe')], intState);
    await converse(int, 'char-px-trinh-luc', ['choice-px-luc-nhan'], intState);
    await deduce(inv, 'deduction-px-luc', 'deduction-px-luc-a', invState);
    await travel(int, [S('pho'), S('cam-do')], intState);
    for (const page of pages) await clickContinue(page);
    await expect.poll(async () => (await invState()).currentSceneId, { timeout: 30_000 }).toBe(S('hieu-anh'));
    await expect.poll(async () => (await intState()).currentSceneId, { timeout: 30_000 }).toBe(S('hieu-anh'));

    step('scene 6');
    // ---- scene 6: hiệu ảnh
    await inspect(inv, 'item-px-la-thu-trang', invState);
    await inspect(inv, 'item-px-thuoc-hien', invState);
    await inspect(inv, 'item-px-keo-ep-anh', invState);
    await combine(inv, ['item-px-la-thu-trang', 'item-px-thuoc-hien'], 'item-px-thu-hien-chu', invState);
    await askAll(int, 'char-px-to-khanh', intState);
    await deduce(inv, 'deduction-px-keo', 'deduction-px-keo-a', invState);
    await capture(inv, 'hieu-anh-investigator');
    // The sequence puzzle sits on the square's clock: walk out, solve it, walk back in.
    await travel(inv, [S('pho')], invState);
    await solveSequence(inv, fixture.puzzles.find((p: any) => p.puzzleId === 'puzzle-px-hanh-trinh'), invState);
    await travel(inv, [S('hieu-anh')], invState);
    await expect.poll(async () => (await invState()).availableForAccusation, { timeout: 30_000 }).toBe(true);
    await capture(inv, 'ready-to-accuse');

    step('final accusation');
    // ---- final accusation with both detectives' consent
    await closePanel(inv);
    await inv.locator('#accuse-btn').click();
    await inv.locator(`[data-suspect="${fixture.finalLogic.culpritId}"]`).click();
    await inv.locator('#accuse-next').click();
    await inv.locator(`[data-motive="${fixture.finalLogic.correctMotiveId}"]`).click();
    await inv.locator('#accuse-next').click();
    await inv.locator(`[data-method="${fixture.finalLogic.correctMethodId}"]`).click();
    await inv.locator('#accuse-next').click();
    for (const link of fixture.finalLogic.requiredEvidenceLinks) {
      await inv.locator(`[data-claim-slot="${link.claimType}"]`).click();
      await inv.locator(`[data-assign-evidence="${link.evidenceId}"]`).click();
    }
    await inv.locator('#accuse-next').click();
    await inv.locator('#accuse-confirm').click();
    await expect(int.locator('#accusation-confirm')).toBeEnabled({ timeout: 20_000 });
    await int.locator('#accusation-confirm').click();
    for (const page of pages) await expect(page).toHaveURL(/\/result\//, { timeout: 30_000 });
    const result = await call<any>(api, 'GET', `/api/game/rooms/${room.roomId}/result`, invAuth.token);
    expect(result.success).toBe(true);
    await inv.screenshot({ path: testInfo.outputPath(`${String(++shot).padStart(2, '0')}-case-closed.png`), fullPage: true });
    expect(failures).toEqual([]);
  } finally {
    await Promise.allSettled(pages.map((page) => page.context().close()));
    await api.dispose();
  }
});

// ------------------------------------------------------------------ helpers

async function login(api: APIRequestContext, email: string) {
  return call<Auth>(api, 'POST', '/api/auth/login', undefined, { email, password: process.env.SIRLOCKED_TEST_PASSWORD });
}

async function call<T>(api: APIRequestContext, method: string, path: string, token?: string, data?: unknown): Promise<T> {
  const response = await api.fetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : undefined, data });
  const body = await response.text();
  expect(response.ok(), `${method} ${path}: ${body}`).toBe(true);
  return JSON.parse(body).data;
}

async function openPlayer(browser: Browser, auth: Auth, roomId: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(({ auth }) => {
    localStorage.setItem('sirlocked.token', auth.token);
    localStorage.setItem('sirlocked.refreshToken', auth.refreshToken);
    localStorage.setItem('sirlocked.refreshExpiry', auth.refreshTokenExpiry);
    localStorage.setItem('sirlocked.user', JSON.stringify(auth.user));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
  }, { auth });
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('#intro-dismiss')).toBeVisible({ timeout: 30_000 });
  return page;
}

async function renderer(page: Page) {
  return page.evaluate(() => {
    const scene = (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene');
    const render = scene.state.visibleScene.runtime?.render;
    const grid = scene.navigationGrid();
    const remote = [...scene.remoteDisplayPoses.values()][0];
    return {
      mode: render?.mode, projection: render?.projection,
      nativePixel: scene.pixelViewScale() * (render?.pixelScale ?? 1),
      gridCells: grid ? grid.cells.reduce((sum: number, cell: number) => sum + cell, 0) : 0,
      remote: remote ? { facing: remote.facing } : null,
    };
  });
}

async function pose(page: Page) {
  return page.evaluate(() => ({ ...(window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').localPose }));
}

async function holdKey(page: Page, key: string, ms: number) {
  await page.locator('canvas').first().focus().catch(() => undefined);
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

async function waitForSceneInput(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__sirlockedGame?.scene.getScene('SirLockedPhaserScene')?.sceneInteractionEnabled)), { timeout: 20_000 }).toBe(true);
}

async function settle(page: Page) {
  await waitForSceneInput(page);
  await expect.poll(() => page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').load.isLoading())).toBe(false);
  await page.waitForTimeout(250);
}

/** Like a player clicking the floor: walk to the floor point nearest a box (beside a person), then wait to arrive. */
async function walkNear(page: Page, box: Box, person = false) {
  await waitForSceneInput(page);
  const target = await page.evaluate(({ box, person }) => {
    const scene = (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene');
    const point = scene.pixelApproachPoint(`test:${box.x}:${box.y}`, box, person);
    if (!point) throw new Error('No floor near the target.');
    scene.navigateTo(point);
    return point;
  }, { box, person });
  await expect.poll(async () => {
    const current = await pose(page);
    return Math.hypot(current.x - target.x, current.y - target.y) < 6 && !current.moving;
  }, { timeout: 30_000 }).toBe(true);
}

/** Screen point of a runtime point, after the camera has followed the player. */
async function screenPoint(page: Page, point: { x: number; y: number }) {
  return page.evaluate((point) => {
    const game = (window as any).__sirlockedGame;
    const scene = game.scene.getScene('SirLockedPhaserScene');
    const world = scene.worldPoint(point);
    const camera = scene.cameras.main;
    const rect = game.canvas.getBoundingClientRect();
    return { x: rect.x + (world.x - camera.scrollX) * rect.width / game.scale.width,
      y: rect.y + (world.y - camera.scrollY) * rect.height / game.scale.height };
  }, point);
}

async function targetBox(page: Page, targetId: string): Promise<Box> {
  return page.evaluate((targetId) => {
    const scene = (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene');
    const runtime = scene.state.visibleScene.runtime;
    const placement = [...runtime.itemPlacements, ...runtime.characterPlacements]
      .find((entry: any) => entry.itemId === targetId || entry.characterId === targetId);
    if (placement) return placement.hotspot;
    const hotspot = scene.state.visibleScene.hotspots.find((entry: any) => entry.targetId === targetId);
    if (!hotspot) throw new Error(`Missing target ${targetId}`);
    const w = runtime.width, h = runtime.height;
    return { x: hotspot.x / 100 * w, y: hotspot.y / 100 * h, width: hotspot.width / 100 * w, height: hotspot.height / 100 * h };
  }, targetId);
}

async function clickTarget(page: Page, targetId: string) {
  const box = await targetBox(page, targetId);
  await walkNear(page, box, targetId.startsWith('char-'));
  await page.waitForTimeout(200);
  const point = await screenPoint(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.6 });
  await page.mouse.click(point.x, point.y);
}

async function clearDiscovery(page: Page) {
  const dismiss = page.locator('#discovery-dismiss-btn');
  if (await dismiss.isVisible()) await dismiss.click();
}

async function closePanel(page: Page) {
  await clearDiscovery(page);
  const close = page.locator('.close-drawer-btn');
  if (await close.isVisible()) await close.click();
  else if (await page.locator('[data-close-overlay]').isVisible()) await page.locator('[data-close-overlay]').click();
  await waitForSceneInput(page);
}

async function inspect(page: Page, itemId: string, state: () => Promise<any>) {
  await closePanel(page);
  await clickTarget(page, itemId);
  await expect.poll(async () => (await state()).inspectedItemIds.includes(itemId), { timeout: 20_000 }).toBe(true);
  await closePanel(page);
}

async function inspectEnvironment(page: Page, interactionId: string, state: () => Promise<any>) {
  await closePanel(page);
  await clickTarget(page, interactionId);
  await expect.poll(async () => (await state()).usedInteractionIds.includes(interactionId), { timeout: 20_000 }).toBe(true);
  await closePanel(page);
}

async function photograph(page: Page, clueId: string, state: () => Promise<any>) {
  await closePanel(page);
  const zone = await page.evaluate((clueId) => {
    const scene = (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene');
    return scene.state.visibleScene.runtime.clueZones.find((entry: any) => entry.clueId === clueId).bounds;
  }, clueId);
  await walkNear(page, zone);
  await page.locator('#floating-camera-btn').click();
  const point = await screenPoint(page, { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 });
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await state()).capturedClueIds.includes(clueId), { timeout: 20_000 }).toBe(true);
  await clearDiscovery(page);
  if (await page.locator('#floating-camera-btn').getAttribute('aria-pressed') === 'true') await page.locator('#floating-camera-btn').click();
  await waitForSceneInput(page);
}

async function useItemOn(page: Page, itemId: string, targetId: string, clueId: string, state: () => Promise<any>) {
  await closePanel(page);
  await page.locator('#floating-bag-btn').click();
  await page.locator(`[data-inventory="${itemId}"]`).click();
  await page.locator(`[data-use-inventory="${itemId}"]`).click();
  await waitForSceneInput(page);
  await clickTarget(page, targetId);
  await expect.poll(async () => (await state()).unlockedClueIds.includes(clueId), { timeout: 20_000 }).toBe(true);
  await closePanel(page);
}

async function combine(page: Page, itemIds: string[], resultId: string, state: () => Promise<any>) {
  await closePanel(page);
  await page.locator('#floating-bag-btn').click();
  await page.locator('#combine-mode-btn').click();
  for (const id of itemIds) await page.locator(`[data-inventory="${id}"]`).click();
  await page.locator('#combine-submit-btn').click();
  await expect.poll(async () => (await state()).collectedItemIds.includes(resultId), { timeout: 20_000 }).toBe(true);
  await closePanel(page);
}

async function solveCode(page: Page, targetId: string, code: string, puzzleId: string, state: () => Promise<any>) {
  await closePanel(page);
  await clickTarget(page, targetId);
  await expect(page.locator('#puzzle-submit-btn')).toBeVisible({ timeout: 20_000 });
  // One dial per character of the lock; typing moves to the next dial.
  await expect(page.locator('[data-code-cell]')).toHaveCount(code.length);
  const enter = async (value: string) => {
    for (const [index, char] of [...value].entries()) await page.locator(`[data-code-cell="${index}"]`).fill(char);
  };
  await enter('0'.repeat(code.length));
  const rejected = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/solve-puzzle'));
  await page.locator('#puzzle-submit-btn').click();
  await rejected;
  expect((await state()).solvedPuzzleIds).not.toContain(puzzleId);
  await enter(code);
  await page.locator('#puzzle-submit-btn').click();
  await expect.poll(async () => (await state()).solvedPuzzleIds.includes(puzzleId), { timeout: 20_000 }).toBe(true);
  await closePanel(page);
}

async function solveSequence(page: Page, puzzle: any, state: () => Promise<any>) {
  await closePanel(page);
  await clickTarget(page, puzzle.targetId);
  await expect(page.locator('#puzzle-submit-btn')).toBeVisible({ timeout: 20_000 });
  for (const option of [...puzzle.correctSequence].reverse()) await page.locator(`[data-puzzle-option="${option.replaceAll('"', '\\"')}"]`).click();
  const rejected = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/solve-puzzle'));
  await page.locator('#puzzle-submit-btn').click();
  await rejected;
  expect((await state()).solvedPuzzleIds).not.toContain(puzzle.puzzleId);
  await page.locator('#puzzle-clear-btn').click();
  for (const option of puzzle.correctSequence) await page.locator(`[data-puzzle-option="${option.replaceAll('"', '\\"')}"]`).click();
  await page.locator('#puzzle-submit-btn').click();
  await expect.poll(async () => (await state()).solvedPuzzleIds.includes(puzzle.puzzleId), { timeout: 20_000 }).toBe(true);
  await closePanel(page);
}

async function askAll(page: Page, characterId: string, state: () => Promise<any>) {
  await closePanel(page);
  const available = (await state()).visibleScene.availableDialogues
    .filter((entry: any) => entry.characterId === characterId && !entry.isAsked && !entry.isLocked);
  expect(available.length, `nothing to ask ${characterId}`).toBeGreaterThan(0);
  await clickTarget(page, characterId);
  await expect(page.locator('.vn-conversation')).toBeVisible({ timeout: 20_000 });
  for (const dialogue of available) {
    await page.locator(`[data-dialogue="${dialogue.dialogueId}"]`).click();
    await expect.poll(async () => (await state()).visibleScene.availableDialogues
      .find((entry: any) => entry.dialogueId === dialogue.dialogueId)?.isAsked, { timeout: 20_000 }).toBe(true);
  }
  await page.locator('[data-vn-close]').click();
  await waitForSceneInput(page);
}

async function converse(page: Page, characterId: string, choiceIds: string[], state: () => Promise<any>) {
  await closePanel(page);
  for (const choiceId of choiceIds) {
    await clickTarget(page, characterId);
    await expect(page.locator(`[data-converse-choice="${choiceId}"]`)).toBeVisible({ timeout: 20_000 });
    const before = (await state()).visitedConversationNodeIds.length;
    await page.locator(`[data-converse-choice="${choiceId}"]`).click();
    await expect.poll(async () => (await state()).visitedConversationNodeIds.length, { timeout: 20_000 }).toBeGreaterThan(before);
    // Lines type out one by one; Space advances until the branch offers its way back.
    const back = page.locator('[data-converse-choice]').filter({ hasText: 'Quay lại' }).first();
    for (let attempt = 0; attempt < 12 && !(await back.isVisible()); attempt++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(250);
    }
    if (await back.isVisible()) await back.click();
    await page.locator('[data-vn-close]').click();
    await waitForSceneInput(page);
  }
}

async function ensureDrawer(page: Page, tab: string) {
  if (await page.locator('#v3-complete-review').isVisible()) await page.locator('#v3-complete-review').click();
  if (!(await page.locator('.case-file-drawer').isVisible())) await page.locator('#case-file-btn').click();
  await page.locator(`[data-case-tab="${tab}"]`).click();
}

async function crack(inv: Page, int: Page, challenge: any, state: () => Promise<any>, tryWrongFirst: boolean) {
  const pair = async (evidenceId: string, correct: boolean) => {
    await ensureDrawer(int, 'testimony');
    await int.locator(`[data-v3-start-testimony="${challenge.testimonyFragmentId}"]`).first().click();
    await ensureDrawer(inv, 'evidence');
    await inv.locator(`[data-v3-propose-evidence="${evidenceId}"]`).click();
    await expect(int.locator('.v3-joint-review')).toBeVisible({ timeout: 20_000 });
    await inv.locator('[data-v3-confirm]').click();
    await int.locator('[data-v3-confirm]').click();
    for (const page of [inv, int]) {
      await expect(page.locator(`.v3-crack-overlay.is-${correct ? 'correct' : 'incorrect'}`)).toBeVisible({ timeout: 20_000 });
      await page.locator('#v3-crack-dismiss').click();
    }
  };
  for (const page of [inv, int]) await closePanel(page);
  if (tryWrongFirst) {
    const wrong = challenge.candidateEvidenceIds.find((id: string) => id !== challenge.correctEvidenceId
      && challenge.startRequiredEvidenceIds.includes(id));
    await pair(wrong, false);
    for (const id of challenge.unlockClueIds) expect((await state()).unlockedClueIds).not.toContain(id);
  }
  await pair(challenge.correctEvidenceId, true);
  await expect.poll(async () => (await state()).resolvedConfrontations
    .some((entry: any) => entry.challengeId === challenge.challengeId), { timeout: 20_000 }).toBe(true);
  for (const page of [inv, int]) await closePanel(page);
}

async function deduce(page: Page, deductionId: string, optionId: string, state: () => Promise<any>) {
  await closePanel(page);
  await expect.poll(async () => (await state()).deductions.find((entry: any) => entry.deductionId === deductionId)?.isAvailable,
    { timeout: 20_000 }).toBe(true);
  await ensureDrawer(page, 'deductions');
  await page.locator(`[data-solve-deduction="${deductionId}"][data-option="${optionId}"]`).click();
  await expect.poll(async () => (await state()).solvedDeductions.some((entry: any) => entry.deductionId === deductionId),
    { timeout: 20_000 }).toBe(true);
  await closePanel(page);
}

/** Click a door in the current scene and wait for the move to the target scene. */
async function useDoor(page: Page, targetSceneId: string) {
  await closePanel(page);
  const box = await page.evaluate((target) => {
    const scene = (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene');
    const transition = scene.state.visibleScene.runtime.transitions.find((entry: any) => entry.targetSceneId === target);
    if (!transition) throw new Error(`No door to ${target}`);
    return transition.hotspot;
  }, targetSceneId);
  await walkNear(page, box);
  await page.waitForTimeout(200);
  const point = await screenPoint(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.mouse.click(point.x, point.y);
}

async function travel(page: Page, route: string[], state: () => Promise<any>) {
  for (const sceneId of route) {
    await useDoor(page, sceneId);
    await expect.poll(async () => (await state()).currentSceneId, { timeout: 30_000 }).toBe(sceneId);
    await waitForSceneInput(page);
  }
}

async function clickContinue(page: Page) {
  await closePanel(page);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').proceedButtonPoint)),
    { timeout: 20_000 }).toBe(true);
  const point = await page.evaluate(() => {
    const game = (window as any).__sirlockedGame;
    const button = game.scene.getScene('SirLockedPhaserScene').proceedButtonPoint;
    const rect = game.canvas.getBoundingClientRect();
    return { x: rect.x + button.x * rect.width / game.scale.width, y: rect.y + button.y * rect.height / game.scale.height };
  });
  await page.mouse.click(point.x, point.y);
}
