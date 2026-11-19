import { mkdirSync } from 'node:fs';
import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * The cosmetics admin area end to end against a running API (Development, loopback Mongo):
 *   1. an admin makes a painted frame from a picture, lines up the hole, turns on effects, saves, makes it the reward of level 5,
 *   2. a player reaches level 5, sees the frame, wears it, and it shows on the profile and in the lobby,
 *   3. a title in the kimlong style with a new name,
 *   4. an entrance on the kim-long template with another picture, previewed full screen with no console error.
 * Only the image host is replaced: a local machine has no Cloudinary, so the upload answers with a picture that ships.
 *
 *   SIRLOCKED_RUN_ADMIN_COSMETICS_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://127.0.0.1:5312 \
 *   SIRLOCKED_TEST_ADMIN_EMAIL=... SIRLOCKED_TEST_ADMIN_PASSWORD=... \
 *   SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5182 SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 \
 *   npx playwright test tests/admin-cosmetics-full-stack.spec.ts
 *
 * The API must run with Auth__AutoVerifyRegistrations=true. Set SIRLOCKED_ADMIN_COSMETICS_EVIDENCE_DIR to keep the screenshots.
 */
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string; fullName: string; role?: string } };
type Progress = {
  level: number; xp: number; xpToNext: number; frameDefId: string | null; titleDefId: string; entranceDefId: string;
  exchangeable: Array<{ itemId: string; xp: number }>;
  owned: Array<{ itemId: string; defId: string; source: string }>;
};

const enabled = process.env.SIRLOCKED_RUN_ADMIN_COSMETICS_FULL_STACK === 'true';
const evidenceDir = process.env.SIRLOCKED_ADMIN_COSMETICS_EVIDENCE_DIR;
const EPIC = 'VC-0405';
const FRAME_PICTURE = '/assets/cosmetics/vien-dong.webp';
const CREATURE_PICTURE = '/assets/cosmetics/phuong-bay.webp';

test('an admin makes cosmetics with no code, and a player earns and wears them', async ({ browser }, testInfo) => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_ADMIN_COSMETICS_FULL_STACK=true against a running loopback API.');
  test.setTimeout(420_000);
  if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  const shot = async (page: Page, name: string, options: { fullPage?: boolean } = {}) => {
    await page.screenshot({ path: evidenceDir ? `${evidenceDir}/${name}.png` : testInfo.outputPath(`${name}.png`), ...options });
  };

  const api = await request.newContext({ baseURL: process.env.SIRLOCKED_TEST_API_URL });
  const admin = await login(api, process.env.SIRLOCKED_TEST_ADMIN_EMAIL!, process.env.SIRLOCKED_TEST_ADMIN_PASSWORD!);
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const playerName = `Thám tử Thử ${run}`;
  const veteranName = `Thám tử Kỳ Cựu ${run}`;
  const player = await register(api, playerName, `thu.${run}@tests.invalid`);
  const veteran = await register(api, veteranName, `kycuu.${run}@tests.invalid`);
  const grant = (auth: Auth, defId: string) => call(api, 'POST', '/api/market/admin/grant', admin.token, { userId: auth.user.userId, defId, coins: 0 });
  const failures: string[] = [];

  // ---- who may call it: a real 403 from the real API
  for (const [method, path] of [
    ['GET', '/api/admin/cosmetics'],
    ['POST', '/api/admin/cosmetics'],
    ['PUT', '/api/admin/cosmetics/settings/xp'],
    ['POST', '/api/admin/cosmetics/frame_dong/grant'],
    ['DELETE', '/api/admin/cosmetics/frame_dong?reason=x'],
  ] as const) {
    const answer = await api.fetch(path, { method, headers: { Authorization: `Bearer ${player.token}` }, data: method === 'GET' || method === 'DELETE' ? undefined : {} });
    expect(answer.status(), `${method} ${path}`).toBe(403);
  }
  expect((await api.get('/api/admin/cosmetics')).status()).toBe(401);
  expect((await api.get('/api/cosmetics/catalog', { headers: { Authorization: `Bearer ${player.token}` } })).status()).toBe(200);

  // ---- the veteran is already past level 5 when the reward is added
  await grant(veteran, EPIC);
  await grant(veteran, EPIC);
  await grant(veteran, EPIC);
  const veteranItems = (await call<Progress>(api, 'GET', '/api/progress/me', veteran.token)).exchangeable.map((item) => item.itemId);
  await call(api, 'POST', '/api/progress/exchange', veteran.token, { itemIds: veteranItems, idempotencyKey: crypto.randomUUID() });
  expect((await call<Progress>(api, 'GET', '/api/progress/me', veteran.token)).level).toBeGreaterThan(5);

  // ---- 1. the frame
  const adminPage = await openAs(browser, admin, { width: 1440, height: 900 }, failures, '/admin/cosmetics');
  await adminPage.route((url) => url.pathname === '/api/admin/assets', async (route) => {
    const picture = route.request().postData()?.includes('sinh-vat') ? CREATURE_PICTURE : FRAME_PICTURE;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { url: picture, width: 247, height: 259 } }) });
  });
  await expect(adminPage.locator('[data-card="frame_kimlong"]')).toBeVisible();
  await adminPage.waitForTimeout(1500);
  await shot(adminPage, '01-luoi-vien');

  const frameName = `Hắc Long ${run}`;
  await adminPage.locator('[data-new]').click();
  await adminPage.locator('#acf-name').fill(frameName);
  await adminPage.locator('#acf-name-en').fill(`Black Dragon ${run}`);
  await adminPage.locator('#acf-rarity').selectOption('EPIC');
  // The picture a browser reads is the one the upload sends: a real one that ships with the game.
  const upload = await pictureFile(adminPage, FRAME_PICTURE, 'vien.png');
  await adminPage.locator('[data-picture]').setInputFiles(upload);
  await expect(adminPage.locator('[data-align]')).toBeVisible();

  // vien-dong's hole, as ARTM places it: centre (123.8, 129.8), radius 78.3 in picture pixels.
  await adminPage.locator('[data-align]').scrollIntoViewIfNeeded();
  const area = await adminPage.locator('[data-align]').boundingBox();
  const ring = await adminPage.locator('[data-ring]').boundingBox();
  const k = area!.width / 247;
  await adminPage.mouse.move(ring!.x + ring!.width / 2, ring!.y + ring!.height / 2);
  await adminPage.mouse.down();
  await adminPage.mouse.move(area!.x + 123.8 * k, area!.y + 129.8 * k, { steps: 5 });
  await adminPage.mouse.up();
  await adminPage.locator('[data-hole="r"]').fill('78');
  await adminPage.locator('[data-effect-on="spark"]').check();
  await adminPage.locator('[data-effect-on="comet"]').check();
  await adminPage.locator('[data-effect-color="aura"]').fill('#78c8ff');
  await adminPage.locator('[data-sheen="on"]').check();
  await adminPage.waitForTimeout(1000);
  await shot(adminPage, '02-tao-vien-can-lo', { fullPage: true });
  await adminPage.locator('[data-save]').click();
  await expect(adminPage.locator('[data-acquisition]')).toBeVisible();
  const frameId = decodeURIComponent((await adminPage.evaluate(() => window.location.pathname + window.location.search)).split('/').pop()!);
  expect(frameId).toMatch(/^frame_hac-long-/);

  await adminPage.locator('input[name="acf-mode"][value="level"]').check();
  await adminPage.locator('#acf-level').fill('5');
  await adminPage.locator('[data-save-way]').click();
  await expect(adminPage.getByRole('dialog')).toContainText('không bán, trao đổi hay đổi KN được nữa');
  await adminPage.locator('#acf-reason').fill('Thưởng cấp 5');
  await adminPage.getByRole('dialog').locator('[data-confirm]').click();
  await expect(adminPage.locator('[data-field="tradable"]')).not.toBeChecked();
  await shot(adminPage, '03-vien-theo-cap-5', { fullPage: true });

  // A reward added later reaches who is already past it, on their next visit to the profile, once.
  const veteranMe = await call<Progress>(api, 'GET', '/api/progress/me', veteran.token);
  expect(veteranMe.owned.filter((item) => item.defId === frameId)).toHaveLength(1);
  const veteranAgain = await call<Progress>(api, 'GET', '/api/progress/me', veteran.token);
  expect(veteranAgain.owned.filter((item) => item.defId === frameId)).toHaveLength(1);

  // What is earned cannot be sold.
  const sold = await api.post('/api/market/listings', {
    headers: { Authorization: `Bearer ${veteran.token}` },
    data: { itemId: veteranMe.owned.find((item) => item.defId === frameId)!.itemId, price: 500, requestId: crypto.randomUUID() },
  });
  expect(sold.status()).toBe(409);
  expect((await sold.json()).errors.code).toBe('MARKET_ITEM_NOT_TRADABLE');

  // A template that does not exist does not get saved, whatever a page sends.
  const bad = await api.post('/api/admin/cosmetics', {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { category: 'FRAME', name: 'Hỏng', rarity: 'RARE', tradable: true, visual: { template: 'la', params: {} } },
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).errors.code).toBe('COSMETIC_TEMPLATE_UNKNOWN');

  // ---- 2. the player reaches level 5 on the page, sees the frame, and wears it
  await grant(player, EPIC);
  await grant(player, EPIC);
  const playerPage = await openAs(browser, player, { width: 1440, height: 900 }, failures, '/detective');
  await expect(playerPage.locator('#hs-p-doi')).toContainText('Đổi tất cả');
  await playerPage.getByRole('button', { name: /Đổi tất cả/ }).click();
  await playerPage.getByRole('dialog').locator('[data-ok]').click();
  const unlock = playerPage.getByRole('dialog');
  // An interrupted earlier run may have left a level 5 reward of its own: each new frame has its own screen.
  for (;;) {
    await expect(unlock).toContainText('Cấp 5 · mở khóa viền mới');
    if ((await unlock.textContent())?.includes(frameName)) break;
    const previous = await unlock.textContent();
    await unlock.locator('[data-close]').click();
    await expect(unlock).not.toHaveText(previous ?? '');
  }
  await playerPage.waitForTimeout(1000);
  await shot(playerPage, '04-mo-khoa-vien');
  await unlock.locator('[data-use]').click();
  await expect.poll(async () => (await call<Progress>(api, 'GET', '/api/progress/me', player.token)).frameDefId).toBe(frameId);

  await playerPage.getByRole('tab', { name: 'Viền avatar' }).click();
  const tile = playerPage.locator(`[data-hs-frame="${frameId.replace('frame_', '')}"]`);
  await expect(tile).toContainText(frameName);
  await expect(tile).toContainText('Cấp 5');
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
  await playerPage.waitForTimeout(1200);
  await shot(playerPage, '05-ho-so-dang-dung-vien', { fullPage: false });

  // ... and in a lobby: the painted picture, on the seat of whoever wears it.
  const cases = await call<Array<{ caseId: string }>>(api, 'GET', '/api/cases/published', player.token);
  const room = await call<{ roomId: string; roomCode: string }>(api, 'POST', '/api/rooms', player.token, { caseId: cases[0].caseId });
  const seen = await call<{ players: Array<{ userId: string; frameDefId: string | null }> }>(api, 'GET', `/api/rooms/${room.roomId}`, player.token);
  expect(seen.players.find((one) => one.userId === player.user.userId)?.frameDefId).toBe(frameId);
  await playerPage.goto(`/lobby/${room.roomId}`);
  const seat = playerPage.locator(`[data-seat-avatar="${player.user.userId}"]`);
  await expect(seat).toBeVisible();
  await expect.poll(() => seatPaintsFrame(playerPage, player.user.userId, frameId)).toBe(true);
  await playerPage.waitForTimeout(1200);
  await shot(playerPage, '06-sanh-cho-dung-vien');

  // ---- 3. the title
  await adminPage.goto('/admin/cosmetics/new?type=TITLE');
  const titleName = `Hắc Long ${run}`;
  await adminPage.locator('#acf-name').fill(titleName);
  await adminPage.locator('#acf-rarity').selectOption('MYSTERY');
  await adminPage.locator('[data-style="kimlong"]').click();
  await expect(adminPage.locator('[data-title-full] .hs-tl')).toHaveAttribute('aria-label', `Danh hiệu ${titleName}`);
  await adminPage.waitForTimeout(800);
  await shot(adminPage, '07-tao-danh-hieu-kimlong', { fullPage: true });
  await adminPage.locator('[data-save]').click();
  await expect(adminPage.locator('[data-acquisition]')).toBeVisible();
  const titleId = decodeURIComponent((await adminPage.evaluate(() => window.location.pathname + window.location.search)).split('/').pop()!);
  await grant(player, titleId);

  await playerPage.goto('/detective');
  await playerPage.getByRole('tab', { name: 'Danh hiệu' }).click();
  const plaque = playerPage.locator(`[data-hs-title-id="${titleId.replace('title_', '')}"]`);
  await expect(plaque.locator('.hs-tl')).toHaveAttribute('aria-label', `Danh hiệu ${titleName}`);
  await plaque.click();
  await expect.poll(async () => (await call<Progress>(api, 'GET', '/api/progress/me', player.token)).titleDefId).toBe(titleId);
  await expect(playerPage.locator('[data-hs-title] .hs-tl')).toHaveAttribute('aria-label', `Danh hiệu ${titleName}`);
  await shot(playerPage, '08-ho-so-dung-danh-hieu');

  // ---- 4. the entrance
  const consoleErrors: string[] = [];
  adminPage.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  adminPage.on('pageerror', (error) => consoleErrors.push(error.message));
  await adminPage.goto('/admin/cosmetics/new?type=ENTRANCE');
  await adminPage.locator('#acf-name').fill(`Hắc Long Giáng Thế ${run}`);
  await adminPage.locator('#acf-rarity').selectOption('LEGENDARY');
  await adminPage.locator('#acf-desc').fill('Rồng đen lượn qua mây.');
  await adminPage.locator('[data-template]').selectOption('kim-long');
  await adminPage.locator('[data-tint-on]').check();
  await adminPage.locator('[data-creature-input]').setInputFiles(await pictureFile(adminPage, CREATURE_PICTURE, 'sinh-vat.png'));
  await expect(adminPage.locator('[data-creature-status]')).toHaveText('Đang dùng ảnh riêng.');
  await adminPage.waitForTimeout(800);
  await shot(adminPage, '09-tao-hieu-ung-kim-long', { fullPage: true });

  await adminPage.locator('[data-play]').click();
  const stage = adminPage.locator('.hs-stage');
  await expect(stage).toBeVisible();
  await adminPage.waitForTimeout(3600);
  await shot(adminPage, '10-xem-thu-toan-man-hinh');
  await expect(stage.locator('.hs-show')).toBeVisible({ timeout: 8000 });
  await stage.locator('.hs-skip').click();
  await expect(stage).toHaveCount(0);

  await adminPage.locator('[data-save]').click();
  await expect(adminPage.locator('[data-acquisition]')).toBeVisible();
  const entranceId = decodeURIComponent((await adminPage.evaluate(() => window.location.pathname + window.location.search)).split('/').pop()!);
  const stored = await call<{ visual: { template: string; params: Record<string, unknown> } }>(api, 'GET', `/api/admin/cosmetics/${entranceId}`, admin.token);
  expect(stored.visual.template).toBe('kim-long');
  expect(stored.visual.params.imageUrl).toBe(CREATURE_PICTURE);
  expect(consoleErrors).toEqual([]);

  // ---- retire leaves what is worn on the player
  await adminPage.goto(`/admin/cosmetics/${frameId}`);
  await adminPage.locator('[data-retire]').click();
  await adminPage.locator('#acf-reason').fill('Thử retire');
  await adminPage.getByRole('dialog').locator('[data-confirm]').click();
  await expect(adminPage.locator('[data-retire]')).toHaveText('Phát hành lại');
  expect((await call<Progress>(api, 'GET', '/api/progress/me', player.token)).frameDefId).toBe(frameId);

  // ---- XP rates take effect on the next exchange
  await adminPage.goto('/admin/cosmetics?tab=xp');
  const rates = { rare: await adminPage.locator('[data-rare]').inputValue(), epic: await adminPage.locator('[data-epic]').inputValue() };
  await adminPage.locator('[data-epic]').fill('333');
  await adminPage.locator('[data-save-xp]').click();
  await adminPage.locator('#acf-reason').fill('Thử đổi tỉ lệ');
  await shot(adminPage, '11-thiet-lap-kn');
  await adminPage.getByRole('dialog').locator('[data-confirm]').click();
  await expect(adminPage.getByText('Đã lưu tỉ lệ kinh nghiệm.')).toBeVisible();
  await grant(player, EPIC);
  const offered = (await call<Progress>(api, 'GET', '/api/progress/me', player.token)).exchangeable[0];
  expect(offered.xp).toBe(333);
  await call(api, 'PUT', '/api/admin/cosmetics/settings/xp', admin.token, { rareXp: Number(rates.rare), epicXp: Number(rates.epic), reason: 'Trả lại sau khi thử' });

  // ---- grant, with the audit trail to show for it
  await adminPage.goto(`/admin/cosmetics?tab=grant&def=${entranceId}`);
  await adminPage.locator('[data-player-search]').fill(run);
  await adminPage.getByRole('option', { name: new RegExp(playerName) }).click();
  await shot(adminPage, '12-cap-cho-nguoi-choi');
  await adminPage.locator('[data-grant-send]').click();
  await adminPage.locator('#acf-reason').fill('Quà thử nghiệm');
  await adminPage.getByRole('dialog').locator('[data-confirm]').click();
  await expect(adminPage.getByText(`Đã cấp cho ${playerName}.`)).toBeVisible();
  const owned = (await call<Progress>(api, 'GET', '/api/progress/me', player.token)).owned;
  expect(owned.filter((item) => item.defId === entranceId)).toHaveLength(1);
  const audit = await call<{ items: Array<{ action: string; reason: string; adminId: string }> }>(api, 'GET', `/api/admin/audit?targetType=catalogItem&targetId=${frameId}`, admin.token);
  expect(audit.items.map((entry) => entry.action)).toEqual(['item.retire', 'item.acquisition', 'item.create']);
  expect(audit.items[0].reason).toBe('Thử retire');
  const grants = await call<{ items: Array<{ reason: string }> }>(api, 'GET', `/api/admin/audit?action=player.grant&targetId=${player.user.userId}`, admin.token);
  expect(grants.items[0].reason).toBe('Quà thử nghiệm');

  // ---- the player's entrance reaches the tab of their profile, and the market lists what can be sold
  await playerPage.goto('/detective');
  await playerPage.reload();
  await playerPage.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();
  await expect(playerPage.locator(`[data-hs-entrance="${entranceId.replace('entrance_', '')}"]`)).toContainText('Rồng đen lượn qua mây.');
  await shot(playerPage, '13-ho-so-hieu-ung-moi', { fullPage: false });
  const catalog = await call<Array<{ id: string }>>(api, 'GET', '/api/market/catalog', player.token);
  expect(catalog.some((def) => def.id === entranceId)).toBe(true);
  expect(catalog.some((def) => def.id === frameId)).toBe(false);

  // ---- phone
  const phone = await openAs(browser, admin, { width: 390, height: 844 }, failures, '/admin/cosmetics', true);
  await expect(phone.locator('[data-card]').first()).toBeVisible();
  await phone.waitForTimeout(1000);
  await shot(phone, '14-dien-thoai-luoi');
  await expectNoSidewaysScroll(phone);
  await phone.goto(`/admin/cosmetics/${frameId}`);
  await expect(phone.locator('[data-preview]')).toBeVisible();
  await phone.waitForTimeout(1000);
  await shot(phone, '15-dien-thoai-sua-vien');
  await expectNoSidewaysScroll(phone);
  await phone.goto('/admin/cosmetics/new?type=TITLE');
  await expect(phone.locator('[data-style]')).toHaveCount(18);
  await phone.waitForTimeout(800);
  await shot(phone, '16-dien-thoai-tao-danh-hieu');
  await expectNoSidewaysScroll(phone);
  await phone.goto('/admin/cosmetics/new?type=ENTRANCE');
  await expect(phone.locator('[data-play]')).toBeVisible();
  await phone.waitForTimeout(800);
  await shot(phone, '17-dien-thoai-tao-hieu-ung');
  await expectNoSidewaysScroll(phone);

  expect(failures).toEqual([]);

  // A later run on this database starts without this reward.
  await call(api, 'PUT', `/api/admin/cosmetics/${frameId}/retired`, admin.token, { retired: false, reason: 'Dọn sau khi thử' });
  await call(api, 'PUT', `/api/admin/cosmetics/${frameId}/acquisition`, admin.token, { mode: 'admin', reason: 'Dọn sau khi thử' });
  await api.dispose();
});

/** Whether a seat draws this frame: its picture has come, and the canvas holds paint where the picture is. */
async function seatPaintsFrame(page: Page, userId: string, frameId: string) {
  return page.evaluate(async ({ userId, frameId }) => {
    const frames = await import('/Client/js/cosmetics/frames.js' as string);
    const frame = frames.FR[frameId.replace('frame_', '')];
    if (!frame?.pic || !frames.picImg(frame.pic)) return false;
    const canvas = document.querySelector(`[data-seat-avatar="${userId}"]`) as HTMLCanvasElement | null;
    if (!canvas || canvas.width === 0) return false;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return painted > canvas.width * canvas.height * 0.3;
  }, { userId, frameId });
}

/** A shipped picture as a file to upload, converted to PNG in the page so the browser's own checks run on it. */
async function pictureFile(page: Page, url: string, name: string) {
  const base64 = await page.evaluate(async (source) => {
    const bitmap = await createImageBitmap(await (await fetch(source)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  }, url);
  return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

async function expectNoSidewaysScroll(page: Page) {
  // .bpa-rim, the route's lens transition, overflows for a moment on every page.
  await page.waitForTimeout(900);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function login(api: APIRequestContext, email: string, password: string): Promise<Auth> {
  const response = await api.post('/api/auth/login', { data: { email, password } });
  expect(response.ok(), `login ${response.status()}`).toBe(true);
  return (await response.json()).data;
}

async function register(api: APIRequestContext, fullName: string, email: string): Promise<Auth> {
  // Development rate-limits registrations per IP; a distinct forwarded loopback client per user keeps reruns stable.
  const response = await api.post('/api/auth/register', {
    data: { fullName, email, password: 'Market-e2e-1!' },
    headers: { 'X-Forwarded-For': `10.79.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  });
  expect(response.ok(), `register ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()).data;
}

async function call<T = unknown>(api: APIRequestContext, method: string, path: string, token: string, data?: unknown): Promise<T> {
  const response = await api.fetch(path, { method, headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), `${method} ${path} ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()).data;
}

async function openAs(browser: Browser, auth: Auth, viewport: { width: number; height: number }, failures: string[], hash: string, touch = false) {
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
  await page.goto(hash);
  return page;
}
