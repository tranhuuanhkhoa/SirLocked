import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Hồ sơ thám tử end to end against a running API (Development, loopback Mongo), with two real detectives:
 *   1. the catalog of the server and the drawing tables of the page hold the same entries,
 *   2. A exchanges items up to level 50 and unlocks every level frame,
 *   3. A and B wear a frame, a title and an entrance from the page,
 *   4. B enters A's room: both screens play B's entrance and show B's frame and title,
 *   5. a reload plays nothing again, the market refuses what was earned, a chest lists cosmetics,
 *   6. the same flow fits a 390×844 phone.
 *
 *   SIRLOCKED_RUN_COSMETICS_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://127.0.0.1:5383 \
 *   SIRLOCKED_TEST_ADMIN_EMAIL=... SIRLOCKED_TEST_ADMIN_PASSWORD=... \
 *   SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5483 SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 \
 *   npx playwright test tests/cosmetics-full-stack.spec.ts
 *
 * The API must run with Auth__AutoVerifyRegistrations=true. Each run registers two fresh users.
 * Set SIRLOCKED_COSMETICS_EVIDENCE_DIR to keep the screenshots somewhere else than the test output.
 */
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string; fullName: string } };
type Progress = {
  level: number; xp: number; xpToNext: number; isMaxLevel: boolean; frameDefId: string | null; titleDefId: string; entranceDefId: string; avatar: string;
  exchangeable: Array<{ itemId: string; xp: number; def: { id: string; rarity: string } }>;
  owned: Array<{ itemId: string; defId: string; source: string; equipped: boolean }>;
};
type Exchange = { level: number; xp: number; xpGained: number; newFrameDefIds: string[]; newTitleDefIds: string[] };

const enabled = process.env.SIRLOCKED_RUN_COSMETICS_FULL_STACK === 'true';
const evidenceDir = process.env.SIRLOCKED_COSMETICS_EVIDENCE_DIR;
const EPIC = 'VC-0405';

test('two detectives: exchange to level 50, wear cosmetics, and enter a room for everyone to see', async ({ browser }, testInfo) => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_COSMETICS_FULL_STACK=true against a running loopback API.');
  test.setTimeout(420_000);
  const api = await request.newContext({ baseURL: process.env.SIRLOCKED_TEST_API_URL });
  const admin = await login(api, process.env.SIRLOCKED_TEST_ADMIN_EMAIL!, process.env.SIRLOCKED_TEST_ADMIN_PASSWORD!);
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const nameA = `Thám tử An ${run}`;
  const nameB = `Thám tử Bình ${run}`;
  const a = await register(api, nameA, `an.${run}@tests.invalid`);
  const b = await register(api, nameB, `binh.${run}@tests.invalid`);
  const grant = (auth: Auth, defId: string) =>
    call(api, 'POST', '/api/market/admin/grant', admin.token, { userId: auth.user.userId, defId, coins: 0 });
  const shot = async (page: Page, name: string) => {
    const path = evidenceDir ? `${evidenceDir}/${name}.png` : testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path });
  };

  const failures: string[] = [];
  const pageA = await openAs(browser, a, { width: 1440, height: 900 }, failures);

  // ---- 1. The server's catalog and the page's drawing tables hold the same entries.
  const catalog = await call<Array<{ id: string; category: string; rarity: string }>>(api, 'GET', '/api/market/catalog', a.token);
  const tables = await pageA.evaluate(async () => {
    const cosmetics = await import('/Client/js/cosmetics/index.js' as string);
    return {
      frames: Object.values(cosmetics.FR as Record<string, any>).filter((f) => f.id !== 'none').map((f) => [f.id, f.rar]),
      titles: (cosmetics.TITLES as any[]).map((t) => [t.id, t.r]),
      entrances: (cosmetics.ENTRANCES as any[]).map((e) => [e.id, e.r]),
    };
  });
  const rarity: Record<string, string> = { common: 'COMMON', rare: 'RARE', myth: 'EPIC', leg: 'LEGENDARY', gold: 'MYSTERY' };
  const expected = [
    ...tables.frames.map(([id, r]: string[]) => [`frame_${id}`, rarity[r]]),
    ...tables.titles.map(([id, r]: string[]) => [`title_${id}`, rarity[r]]),
    ...tables.entrances.map(([id, r]: string[]) => [`entrance_${id}`, rarity[r]]),
  ].sort();
  const served = catalog.filter((def) => ['FRAME', 'TITLE', 'ENTRANCE'].includes(def.category)).map((def) => [def.id, def.rarity]).sort();
  expect(served).toEqual(expected);

  // ---- 2. A climbs from level 1 to 50 through exchanges, the last ones by hand on the page.
  const frames: string[] = [];
  const titles: string[] = [];
  const fill = async (auth: Auth) => {
    const wallet = await call<{ slotsUsed: number; slotCap: number }>(api, 'GET', '/api/market/me', auth.token);
    for (let i = wallet.slotsUsed; i < wallet.slotCap; i++) await grant(auth, EPIC);
  };
  let safety = 0;
  for (;;) {
    const me = await call<Progress>(api, 'GET', '/api/progress/me', a.token);
    // Stop just short of the last level, so the page itself crosses it.
    if (me.level >= 49) break;
    expect(++safety).toBeLessThan(20);
    await fill(a);
    const items = (await call<Progress>(api, 'GET', '/api/progress/me', a.token)).exchangeable;
    const need = (await levelGap(me));
    const batch = items.slice(0, Math.min(items.length, Math.max(1, Math.ceil(need / 600))));
    const result = await call<Exchange>(api, 'POST', '/api/progress/exchange', a.token, { itemIds: batch.map((item) => item.itemId), idempotencyKey: crypto.randomUUID() });
    expect(result.xpGained).toBe(batch.length * 600);
    frames.push(...result.newFrameDefIds);
    titles.push(...result.newTitleDefIds);
  }
  expect(frames).toEqual(['frame_dong', 'frame_bac', 'frame_ngoc', 'frame_vang']);
  expect(titles).toEqual(['title_van-tay']);

  await fill(a);
  await pageA.goto('/market');
  await pageA.goto('/detective');
  await expect(pageA.locator('[data-hs-level]')).toHaveText('49');
  await shot(pageA, '01-profile-exchange');
  await pageA.getByRole('button', { name: /Đổi tất cả/ }).click();
  await expect(pageA.getByRole('dialog')).toContainText('mất vĩnh viễn');
  await shot(pageA, '02-confirm-exchange');
  await pageA.getByRole('dialog').getByRole('button', { name: 'Đổi', exact: true }).click();

  const unlock = pageA.getByRole('dialog', { name: 'Mở khóa viền mới' });
  await expect(unlock.getByRole('heading')).toHaveText('Thám Trưởng');
  await pageA.waitForTimeout(1200);
  await shot(pageA, '03-unlock-level-50');
  await unlock.getByRole('button', { name: 'Dùng ngay' }).click();
  await expect(pageA.locator('[data-hs-xp]')).toHaveText('Cấp tối đa');
  await expect(pageA.locator('[data-hs-level]')).toHaveText('50');
  await expect.poll(async () => (await call<Progress>(api, 'GET', '/api/progress/me', a.token)).frameDefId).toBe('frame_truong');
  const atFifty = await call<Progress>(api, 'GET', '/api/progress/me', a.token);
  expect(atFifty.isMaxLevel).toBe(true);
  expect(atFifty.xp).toBe(0);
  const earned = atFifty.owned.filter((item) => item.source === 'LEVEL').map((item) => item.defId).sort();
  expect(earned).toEqual(['frame_bac', 'frame_dong', 'frame_ngoc', 'frame_truong', 'frame_vang', 'title_tham-tu-truong', 'title_van-tay']);

  // ---- 3. A wears a title and an entrance from the page; B does so too, on a phone.
  await grant(b, 'frame_kimlong');
  await grant(b, 'title_long-phung');
  await grant(b, 'entrance_kim-long');
  await grant(a, 'entrance_van-kiem');
  await pageA.goto('/market');
  await pageA.goto('/detective');
  await pageA.getByRole('tab', { name: 'Viền avatar' }).click();
  await expect(pageA.locator('[data-hs-frame="truong"]')).toHaveAttribute('aria-pressed', 'true');
  await pageA.waitForTimeout(1200);
  await shot(pageA, '04-frames-tab');
  await pageA.getByRole('tab', { name: 'Danh hiệu' }).click();
  await pageA.locator('[data-hs-title-id="tham-tu-truong"]').click();
  await expect(pageA.locator('[data-hs-title] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Thám Tử Trưởng');
  await pageA.waitForTimeout(800);
  await shot(pageA, '05-titles-tab');
  await pageA.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();
  await pageA.locator('[data-hs-entrance="van-kiem"] [data-use]').click();
  await expect(pageA.locator('[data-hs-entrance="van-kiem"] [data-use]')).toHaveText('Đang dùng');
  await shot(pageA, '06-entrances-tab');

  // Previewing an entrance not owned runs the real stage.
  await pageA.locator('[data-hs-entrance="phuong-hoang"] [data-try]').click();
  await expect(pageA.locator('.hs-stage')).toBeVisible();
  await pageA.waitForTimeout(3200);
  await shot(pageA, '07-preview-stage');
  await pageA.getByRole('button', { name: 'Bỏ qua' }).click();
  await expect(pageA.locator('.hs-stage')).toHaveCount(0);

  // The avatar choice is stored per detective.
  await pageA.getByRole('button', { name: 'Đổi ảnh đại diện' }).click();
  await expect(pageA.locator('[data-hs-avatar]')).toHaveCount(4);
  await pageA.getByRole('button', { name: 'Kiếm khách' }).click();
  await expect(pageA.getByRole('button', { name: 'Kiếm khách' })).toHaveAttribute('aria-pressed', 'true');
  expect((await call<Progress>(api, 'GET', '/api/progress/me', a.token)).avatar).toBe('kiem');

  const pageB = await openAs(browser, b, { width: 390, height: 844 }, failures, true);
  await pageB.getByRole('tab', { name: 'Viền avatar' }).click();
  await pageB.locator('[data-hs-frame="kimlong"]').click();
  await expect(pageB.locator('[data-hs-frame="kimlong"]')).toHaveAttribute('aria-pressed', 'true');
  await pageB.getByRole('tab', { name: 'Danh hiệu' }).click();
  await pageB.locator('[data-hs-title-id="long-phung"]').click();
  await expect(pageB.locator('[data-hs-title] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Long Phụng Thần Thám');
  await pageB.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();
  await pageB.locator('[data-hs-entrance="kim-long"] [data-use]').click();
  await expect(pageB.locator('[data-hs-entrance="kim-long"] [data-use]')).toHaveText('Đang dùng');
  await pageB.evaluate(() => window.scrollTo(0, 0));
  await pageB.waitForTimeout(800);
  await shot(pageB, '08-phone-profile');
  await expectNoSidewaysScroll(pageB);

  // ---- 4. A opens a room and plays their own entrance; B enters and both screens play B's.
  const cases = await call<Array<{ caseId: string }>>(api, 'GET', '/api/cases/published', a.token);
  expect(cases.length).toBeGreaterThan(0);
  const room = await call<{ roomId: string; roomCode: string }>(api, 'POST', '/api/rooms', a.token, { caseId: cases[0].caseId });
  await pageA.goto(`/lobby/${room.roomId}`);
  await expect(pageA.locator('.bpa-lobby-pair')).toBeVisible();
  const stageA = pageA.locator('.hs-stage:not(.hs-out)');
  await expect(stageA.locator('.hs-hn')).toHaveText(nameA);
  await expect(stageA.locator('.hs-hero small')).toHaveText('đã vào sảnh · Vạn Kiếm Quy Tông');
  await pageA.getByRole('button', { name: 'Bỏ qua' }).click();
  await expect(pageA.locator('.hs-stage')).toHaveCount(0);

  const joined = await call<{ players: Array<{ userId: string; level: number; avatar: string; frameDefId: string; titleDefId: string; entranceDefId: string }> }>(
    api, 'POST', '/api/rooms/join', b.token, { roomCode: room.roomCode });
  const seenA = joined.players.find((player) => player.userId === a.user.userId)!;
  expect(seenA).toMatchObject({ level: 50, avatar: 'kiem', frameDefId: 'frame_truong', titleDefId: 'title_tham-tu-truong', entranceDefId: 'entrance_van-kiem' });
  const seenB = joined.players.find((player) => player.userId === b.user.userId)!;
  expect(seenB).toMatchObject({ level: 1, frameDefId: 'frame_kimlong', titleDefId: 'title_long-phung', entranceDefId: 'entrance_kim-long' });

  await pageB.goto(`/lobby/${room.roomId}`);
  for (const page of [pageA, pageB]) {
    const stage = page.locator('.hs-stage:not(.hs-out)');
    await expect(stage.locator('.hs-hn')).toHaveText(nameB);
    await expect(stage.locator('.hs-hero small')).toHaveText('đã vào sảnh · Kim Long Giáng Thế');
    await expect(stage.locator('.hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Long Phụng Thần Thám');
  }
  await pageA.waitForTimeout(3600);
  await shot(pageA, '09-entrance-seen-by-a');
  await shot(pageB, '10-entrance-seen-by-b-phone');
  await expect(pageB.getByRole('button', { name: 'Bỏ qua' })).toBeInViewport();
  await pageB.getByRole('button', { name: 'Bỏ qua' }).click();
  await expect(pageB.locator('.hs-stage')).toHaveCount(0);
  await pageA.keyboard.press('Escape');
  await expect(pageA.locator('.hs-stage')).toHaveCount(0);

  // Both seats, on both screens, show what the server says each detective wears.
  for (const page of [pageA, pageB]) {
    await expect(page.locator(`[data-seat-user="${b.user.userId}"] .hs-tl`)).toHaveAttribute('aria-label', 'Danh hiệu Long Phụng Thần Thám');
    await expect(page.locator(`[data-seat-user="${a.user.userId}"] .hs-tl`)).toHaveAttribute('aria-label', 'Danh hiệu Thám Tử Trưởng');
    await expect(page.locator('canvas[data-seat-avatar]')).toHaveCount(2);
  }
  await pageA.waitForTimeout(800);
  await shot(pageA, '11-lobby-desktop');
  await pageB.waitForTimeout(800);
  await expect(pageB.locator('.bpa-rim')).toHaveCount(0);
  await shot(pageB, '12-lobby-phone');
  await expectNoSidewaysScroll(pageB);

  // ---- 5. A reload is not a new arrival.
  await pageB.reload();
  await expect(pageB.locator('.bpa-lobby-pair')).toBeVisible();
  await pageB.waitForTimeout(1500);
  await expect(pageB.locator('.hs-stage')).toHaveCount(0);
  await expect(pageA.locator('.hs-stage')).toHaveCount(0);

  // The market refuses what was earned; the bag does not hold it either.
  const levelFrame = atFifty.owned.find((item) => item.defId === 'frame_dong')!;
  const refused = await api.post('/api/market/listings', {
    headers: { Authorization: `Bearer ${a.token}` },
    data: { itemId: levelFrame.itemId, price: 500, requestId: crypto.randomUUID() },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).errors.code).toBe('MARKET_ITEM_NOT_TRADABLE');
  const bag = await call<{ items: Array<{ def: { id: string } }> }>(api, 'GET', '/api/market/inventory', a.token);
  expect(bag.items.some((item) => item.def.id === 'frame_dong')).toBe(false);

  // A chest lists its cosmetics, and the page still works after leaving the lobby.
  const chests = await call<{ chests: Array<{ id: string; contents: Array<{ id: string }> }> }>(api, 'GET', '/api/chests', a.token);
  expect(chests.chests.find((chest) => chest.id === 'chest_np')!.contents.map((def) => def.id)).toContain('frame_hacduc');
  await pageA.goto('/kho-ruong');
  await expect(pageA.locator('#qh-contents .qh-it')).toHaveCount(24);
  await pageA.waitForTimeout(1200);
  await shot(pageA, '13-chest-with-cosmetics');

  expect(failures).toEqual([]);
  await api.dispose();
});

/** XP still missing to the next ten-level stop, so batches stay small enough to reach each milestone exactly once. */
async function levelGap(me: Progress): Promise<number> {
  let need = me.xpToNext - me.xp;
  for (let level = me.level + 1; level < 49; level++) need += 200 + 40 * (level - 1);
  return need;
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function login(api: APIRequestContext, email: string, password: string): Promise<Auth> {
  const response = await api.post('/api/auth/login', { data: { email, password } });
  const body = await response.text();
  expect(response.ok(), `login ${email}: ${response.status()}`).toBe(true);
  return JSON.parse(body).data;
}

async function register(api: APIRequestContext, fullName: string, email: string): Promise<Auth> {
  // Development rate-limits registrations per IP; a distinct forwarded loopback client per user keeps reruns stable.
  const response = await api.post('/api/auth/register', {
    data: { fullName, email, password: 'Market-e2e-1!' },
    headers: { 'X-Forwarded-For': `10.79.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  });
  const body = await response.text();
  expect(response.ok(), `register ${email}: ${body}`).toBe(true);
  return JSON.parse(body).data;
}

async function call<T = unknown>(api: APIRequestContext, method: string, path: string, token: string, data?: unknown): Promise<T> {
  const response = await api.fetch(path, { method, headers: { Authorization: `Bearer ${token}` }, data });
  const body = await response.text();
  expect(response.ok(), `${method} ${path}: ${body}`).toBe(true);
  return JSON.parse(body).data;
}

async function openAs(browser: Browser, auth: Auth, viewport: { width: number; height: number }, failures: string[], touch = false) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  await page.addInitScript((value) => {
    localStorage.setItem('sirlocked.token', value.token);
    localStorage.setItem('sirlocked.refreshToken', value.refreshToken);
    localStorage.setItem('sirlocked.refreshExpiry', value.refreshTokenExpiry);
    localStorage.setItem('sirlocked.user', JSON.stringify(value.user));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
  }, auth);
  await page.goto('/detective');
  await expect(page.locator('.hs-name')).toBeVisible();
  return page;
}
