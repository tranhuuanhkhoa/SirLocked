import { mkdirSync } from 'node:fs';
import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * The chests and items admin end to end, against a running API (Development, loopback Mongo):
 *   1. an admin creates a curio with an uploaded picture and puts it in a chest; wrong percentages are refused,
 *   2. a detective sees it in "Có thể nhận được", gets a copy, and sees the picture in the bag and on the market,
 *   3. an older version is restored, a new chest is cloned, switched on, bought and opened, then switched off,
 *   4. trying a chest out, the statistics, the log and a grant work, also on a 390x844 phone.
 *
 *   SIRLOCKED_RUN_ADMIN_CHESTS_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://127.0.0.1:5311 \
 *   SIRLOCKED_TEST_ADMIN_EMAIL=admin@sirlocked.local SIRLOCKED_TEST_ADMIN_PASSWORD=<local demo password> \
 *   SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5181 SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 \
 *   node ./node_modules/@playwright/test/cli.js test tests/admin-chests/full-stack.spec.ts
 *
 * Local machines have no Cloudinary: the real refusal is checked first, then the upload answer and the picture itself are
 * supplied by the test. Set SIRLOCKED_ADMIN_EVIDENCE_DIR to keep the screenshots.
 */
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string; fullName: string } };

const enabled = process.env.SIRLOCKED_RUN_ADMIN_CHESTS_FULL_STACK === 'true';
const evidenceDir = process.env.SIRLOCKED_ADMIN_EVIDENCE_DIR;
const PICTURE_URL = 'https://res.cloudinary.com/demo/image/upload/sirlocked/admin/bua-e2e.webp';
const SEAL = 'chest_np';

// A 96 x 96 gold square, written out so the test needs no image library.
const PICTURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAAn0lEQVR42u3RMQ0AAAjAMHThG0+4ABkkpMcMrNGVo7vCBAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAAMAEAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAIAAABAAAAIAQAAACMCHFspIHfuTwxH8AAAAAElFTkSuQmCC',
  'base64',
);

async function login(api: APIRequestContext, email: string, password: string): Promise<Auth> {
  const response = await api.post('/api/auth/login', { data: { email, password } });
  expect(response.ok(), `login ${email}: ${response.status()}`).toBe(true);
  return (await response.json()).data;
}

async function register(api: APIRequestContext, fullName: string, email: string): Promise<Auth> {
  // Development rate-limits registrations per IP; a distinct forwarded client per user keeps reruns working.
  const response = await api.post('/api/auth/register', {
    data: { fullName, email, password: 'Market-e2e-1!' },
    headers: { 'X-Forwarded-For': `10.79.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` },
  });
  const body = await response.text();
  expect(response.ok(), `register ${email}: ${body}`).toBe(true);
  return JSON.parse(body).data;
}

async function call<T>(api: APIRequestContext, method: string, path: string, token: string, data?: unknown): Promise<T> {
  const response = await api.fetch(path, { method, headers: { Authorization: `Bearer ${token}` }, data });
  const body = await response.text();
  expect(response.ok(), `${method} ${path}: ${body}`).toBe(true);
  return JSON.parse(body).data;
}

async function openAs(browser: Browser, auth: Auth, viewport: { width: number; height: number }, failures: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  await page.addInitScript((value) => {
    localStorage.setItem('sirlocked.token', value.token);
    localStorage.setItem('sirlocked.refreshToken', value.refreshToken);
    localStorage.setItem('sirlocked.refreshExpiry', value.refreshTokenExpiry);
    localStorage.setItem('sirlocked.user', JSON.stringify(value.user));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
  }, auth);
  // The picture of the uploaded item, wherever it is drawn.
  await context.route(PICTURE_URL, (route) => route.fulfill({ contentType: 'image/png', body: PICTURE_PNG }));
  return page;
}

/** An <img> with size attributes counts as visible even when its file is broken, so ask whether it really decoded. */
async function expectPictureDrawn(picture: ReturnType<Page['locator']>) {
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(96);
}

async function confirmWithReason(page: Page, reason: string) {
  const dialog = page.locator('dialog.ac-dialog[open]');
  await dialog.locator('[name="reason"]').fill(reason);
  await dialog.locator('[data-ac-confirm]').click();
  await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);
}

test('an admin manages items and chests, and players see the result', async ({ browser }, testInfo) => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_ADMIN_CHESTS_FULL_STACK=true against a running loopback API.');
  test.setTimeout(420_000);
  if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  let shotNumber = 0;
  const shot = async (page: Page, name: string, fullPage = false) => {
    shotNumber += 1;
    const file = `${String(shotNumber).padStart(2, '0')}-${name}.png`;
    await page.waitForTimeout(600); // The route's lens transition.
    await page.screenshot({ path: evidenceDir ? `${evidenceDir}/${file}` : testInfo.outputPath(file), fullPage });
  };

  const api = await request.newContext({ baseURL: process.env.SIRLOCKED_TEST_API_URL });
  const adminAuth = await login(api, process.env.SIRLOCKED_TEST_ADMIN_EMAIL!, process.env.SIRLOCKED_TEST_ADMIN_PASSWORD!);
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const player = await register(api, `Thám tử Quản Trị ${run}`, `adminchest.${run}@tests.invalid`);
  const failures: string[] = [];
  const admin = await openAs(browser, adminAuth, { width: 1440, height: 900 }, failures);

  // ---- A player is refused by the real API.
  const denied = await api.get('/api/admin/items', { headers: { Authorization: `Bearer ${player.token}` } });
  expect(denied.status()).toBe(403);

  // ---- Items: the real refusal without Cloudinary, then an upload.
  await admin.goto('/admin/items');
  await expect(admin.locator('tr[data-item-id="VC-0217"]')).toBeVisible();
  await shot(admin, 'vat-pham-danh-sach');

  await admin.locator('[data-ac-new-item]').click();
  const form = admin.locator('dialog.ac-dialog[open]');
  const nextId = await form.locator('[data-ac-next-id]').innerText();
  expect(nextId).toMatch(/^CU-\d{4,}$/);
  const itemName = `Bùa may mắn ${run}`;
  await form.locator('[name="name"]').fill(itemName);
  await form.locator('[name="nameEn"]').fill(`Lucky charm ${run}`);
  await form.locator('[name="description"]').fill('Một lá bùa cũ tìm thấy ở hiện trường.');
  await form.locator('[name="descriptionEn"]').fill('An old charm found at the scene.');
  await form.locator('[name="rarity"]').selectOption('RARE');
  await form.locator('[name="referencePrice"]').fill('500');

  const file = { name: 'bua.png', mimeType: 'image/png', buffer: PICTURE_PNG };
  await form.locator('input[type="file"]').setInputFiles(file);
  await expect(form.locator('.ac-errors')).toContainText('Cloudinary');
  await shot(admin, 'vat-pham-chua-cau-hinh-cloudinary');

  await admin.route('**/api/admin/assets', (route) => route.fulfill({ json: { success: true, data: { url: PICTURE_URL, width: 96, height: 96 } } }));
  await form.locator('input[type="file"]').setInputFiles(file);
  await expectPictureDrawn(form.locator(`[data-ac-image-preview][src="${PICTURE_URL}"]`));
  await shot(admin, 'vat-pham-tao-co-anh');
  await form.locator('[data-ac-submit]').click();
  const row = admin.locator(`tr[data-item-id="${nextId}"]`);
  await expect(row).toContainText(itemName);
  await admin.locator('[data-ac-search]').fill(nextId);
  await expect(admin.locator('tr[data-item-id]')).toHaveCount(1);
  await expectPictureDrawn(row.locator(`img[src="${PICTURE_URL}"]`)); // Lazy: it loads once the filter brings it on screen.
  await shot(admin, 'vat-pham-da-tao');

  // ---- The chest: wrong percentages are refused with the server's words.
  await admin.goto(`/admin/chests/${SEAL}?tab=bang-roi`);
  await admin.reload();
  const common = admin.locator('input[data-weight="COMMON"]');
  await expect(common).toHaveValue('79.92');
  await common.fill('70');
  await expect(admin.locator('.ac-errors')).toContainText('Tổng trọng số phải bằng');
  await expect(admin.locator('[data-ac-save]')).toBeDisabled();
  await shot(admin, 'hom-ti-le-sai-bi-chan');
  await common.fill('79.92');
  await expect(admin.locator('.ac-errors')).toHaveCount(0);

  await admin.locator('[data-ac-add-item]').click();
  const picker = admin.locator('dialog.ac-dialog[open]');
  await picker.locator('[data-ac-pick-search]').fill(nextId);
  await shot(admin, 'hom-them-vat-pham');
  await picker.locator(`[data-pick-item="${nextId}"]`).click();
  await picker.locator('[data-ac-dialog-close]').click();
  const added = admin.locator(`[data-pool-column="RARE"] [data-pool-item="${nextId}"]`);
  await expect(added).toBeVisible();
  await expect(admin.locator('[data-ac-save]')).toBeEnabled();
  await shot(admin, 'hom-noi-dung-va-ti-le', true);

  await admin.locator('[data-ac-save]').click();
  await expect(admin.locator('dialog.ac-dialog[open]')).toContainText(itemName);
  await shot(admin, 'hom-xac-nhan-luu');
  await confirmWithReason(admin, 'Thêm món sự kiện');
  await expect(admin.locator('[data-ac-save]')).toBeDisabled();

  // ---- The detective sees it, with its picture, everywhere.
  const detective = await openAs(browser, player, { width: 1440, height: 900 }, failures);
  await detective.goto('/kho-ruong');
  await expect(detective.locator('#qh-caseName')).toHaveText('Hòm Niêm Phong');
  await expect(detective.locator('#qh-contents .qh-it', { hasText: itemName })).toBeVisible();
  await shot(detective, 'nguoi-choi-co-the-nhan-duoc');

  const list = await call<{ chests: Array<{ id: string; contents: Array<{ id: string; visual: { imageUrl: string } }> }> }>(api, 'GET', '/api/chests', player.token);
  expect(list.chests.find((chest) => chest.id === SEAL)!.contents.find((def) => def.id === nextId)!.visual.imageUrl).toBe(PICTURE_URL);

  await call(api, 'POST', '/api/market/admin/grant', adminAuth.token, { userId: player.user.userId, defId: nextId, coins: 0 });
  await detective.goto('/market/sell');
  const copy = detective.locator('.bpa-mk-inv', { hasText: itemName });
  await expectPictureDrawn(copy.locator(`img[src="${PICTURE_URL}"]`));
  await shot(detective, 'nguoi-choi-kho-do-co-anh');

  // Selling it puts it on the market, picture included.
  const owned = await call<{ items: Array<{ itemId: string; def: { id: string } }> }>(api, 'GET', '/api/market/inventory', player.token);
  const mine = owned.items.find((entry) => entry.def.id === nextId)!;
  await call(api, 'POST', '/api/market/listings', player.token, { itemId: mine.itemId, price: 600, requestId: `e2e-${run}-list` });
  await detective.goto('/market');
  await detective.locator('.bpa-mk-cat[data-category="CURIO"]').click();
  await expectPictureDrawn(detective.locator(`#mk-rows [data-def="${nextId}"] img[src="${PICTURE_URL}"]`));
  await shot(detective, 'nguoi-choi-cho-do-co-anh');

  // ---- The rules that keep it: owned now, so it can no longer be deleted.
  // The list is paged and a new item sorts last, so it is looked up through the search the top bar links to.
  await admin.goto(`/admin/items?q=${encodeURIComponent(nextId)}`);
  await admin.reload();
  const ownedRow = admin.locator(`tr[data-item-id="${nextId}"]`);
  await expect(ownedRow.locator('[data-ac-copies]')).toHaveText('1');
  await expect(ownedRow.locator('[data-ac-delete]')).toHaveCount(0);
  await expect(ownedRow).toContainText('Hòm Niêm Phong');

  // ---- History: back to the version before the item was added.
  await admin.goto(`/admin/chests/${SEAL}?tab=lich-su`);
  await admin.reload();
  const versions = admin.locator('[data-version]');
  await expect(versions.first()).toContainText('Thêm món sự kiện');
  await shot(admin, 'hom-lich-su');
  const previous = await versions.nth(1).getAttribute('data-version');
  await admin.locator(`[data-version="${previous}"] [data-ac-restore]`).click();
  await confirmWithReason(admin, 'Trả về bản trước để kiểm thử');
  await expect(versions.first()).toContainText('Trả về bản trước');
  const restored = await call<{ chests: Array<{ id: string; contents: Array<{ id: string }> }> }>(api, 'GET', '/api/chests', player.token);
  expect(restored.chests.find((chest) => chest.id === SEAL)!.contents.map((def) => def.id)).not.toContain(nextId);

  // ---- A new chest: cloned, off, then on, bought and opened by a player.
  await admin.goto('/admin/chests');
  await admin.reload();
  await expect(admin.locator(`[data-chest-id="${SEAL}"]`)).toBeVisible();
  await shot(admin, 'hom-danh-sach');
  await admin.locator(`[data-chest-id="${SEAL}"] [data-ac-clone]`).click();
  const clone = admin.locator('dialog.ac-dialog[open]');
  const newChestName = `Hòm Thử ${run}`;
  await clone.locator('[name="name"]').fill(newChestName);
  await clone.locator('[name="nameEn"]').fill(`Test Chest ${run}`);
  await clone.locator('[data-ac-confirm]').click();
  await expect(admin).toHaveURL(/\/admin\/chests\/chest_\d+/);
  const newChestId = decodeURIComponent(admin.url().split('/admin/chests/')[1].split('?')[0]);
  await expect(admin.locator('[data-ac-heading]')).toHaveText(newChestName);
  await shot(admin, 'hom-moi-mac-dinh-tat', true);

  await detective.goto('/kho-ruong');
  await detective.reload();
  await expect(detective.locator('.qh-dot')).toHaveCount(restored.chests.length);

  // The look is part of the same save. Trying the chest out works while it is off.
  await admin.locator('[name="template"]').selectOption('lacquer');
  await admin.locator('[name="light"]').fill('#3366cc');
  await admin.locator('[name="active"]').check();
  await expect(admin.locator('[data-ac-save]')).toBeEnabled();
  await shot(admin, 'hom-thiet-lap-hinh-va-anh-sang', true);
  await admin.locator('[data-ac-preview]').click();
  const overlay = admin.locator('.ac-preview');
  await expect(overlay.locator('#qh-caseName')).toHaveText(newChestName);
  await expect(overlay.locator('#qh-odds')).toContainText('79,92%');
  await shot(admin, 'xem-thu-truoc-khi-mo');
  const itemsBefore = await call<{ items: unknown[] }>(api, 'GET', '/api/market/inventory', adminAuth.token);
  await overlay.locator('#qh-openBtn').click();
  await expect(overlay.locator('#qh-gotName')).not.toHaveText('—', { timeout: 30_000 });
  await shot(admin, 'xem-thu-ket-qua');
  const itemsAfter = await call<{ items: unknown[] }>(api, 'GET', '/api/market/inventory', adminAuth.token);
  expect(itemsAfter.items).toHaveLength(itemsBefore.items.length);
  await overlay.locator('[data-ac-preview-close]').click();
  await expect(admin.locator('.ac-preview')).toHaveCount(0);

  await admin.locator('[data-ac-save]').click();
  await confirmWithReason(admin, 'Mở bán thử');

  await detective.reload();
  await expect(detective.locator('.qh-dot')).toHaveCount(restored.chests.length + 1);
  await detective.locator('.qh-dot').last().click();
  await expect(detective.locator('#qh-caseName')).toHaveText(newChestName);
  await expect.poll(() => detective.locator('.qh-app').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--accent'))).toBe('rgb(51,102,204)');
  await detective.locator('[data-qh-buy="key"]').click();
  await expect(detective.locator('#qh-nKey')).toHaveText('1');
  const shop = await call<{ chestsForSale?: boolean }>(api, 'GET', '/api/chests', player.token);
  if (shop.chestsForSale === false) {
    // Chests are not sold (Chests:SellChests off): they come from rewards, here an admin grant.
    await expect(detective.locator('[data-qh-buy="chest"]')).toBeHidden();
    await call(api, 'POST', '/api/chests/admin/grant', adminAuth.token, { userId: player.user.userId, chestId: newChestId, chests: 1, keys: 0 });
    await detective.reload();
    await detective.locator('.qh-dot').last().click();
  } else {
    await detective.locator('[data-qh-buy="chest"]').click();
  }
  await expect(detective.locator('#qh-nChest')).toHaveText('1');
  await shot(detective, 'nguoi-choi-hom-moi');
  const answer = detective.waitForResponse((response) => response.url().endsWith(`/api/chests/${newChestId}/open`));
  await detective.locator('#qh-openBtn').click();
  const openBody = (await (await answer).json()).data;
  await expect(detective.locator('#qh-gotName')).toHaveText(openBody.item.name, { timeout: 30_000 });
  await shot(detective, 'nguoi-choi-mo-hom-moi');
  await detective.locator('#qh-closeBtn').click();

  // ---- Grant through the page. Then switch off: gone for others, still there for the holder, and not for sale.
  await admin.goto('/admin/chests?tab=cap');
  await admin.reload();
  await admin.locator('[data-ac-player-search]').fill(run);
  await admin.locator(`[data-ac-player="${player.user.userId}"]`).click();
  await admin.locator('[name="chestId"]').selectOption(newChestId);
  await admin.locator('[name="chests"]').fill('1');
  await admin.locator('[name="keys"]').fill('1');
  await shot(admin, 'cap-hom-va-chia');
  await admin.locator('[data-ac-grant]').click();
  await confirmWithReason(admin, 'Kiểm thử cấp hòm');

  await admin.goto('/admin/chests');
  await admin.reload();
  await admin.locator(`[data-chest-id="${newChestId}"] [data-ac-toggle]`).click();
  await confirmWithReason(admin, 'Kết thúc kiểm thử');
  await expect(admin.locator(`[data-chest-id="${newChestId}"]`)).toContainText('Đang tắt');

  await detective.reload();
  await expect(detective.locator('.qh-dot')).toHaveCount(restored.chests.length + 1);
  await detective.locator('.qh-dot').last().click();
  await expect(detective.locator('#qh-caseName')).toHaveText(newChestName);
  await expect(detective.locator('#qh-buy')).toBeHidden();
  await expect(detective.locator('#qh-openLbl')).toHaveText('Mở hòm');
  await shot(detective, 'nguoi-choi-hom-da-tat-van-mo-duoc');
  await detective.locator('#qh-openBtn').click();
  await expect(detective.locator('#qh-gotName')).not.toHaveText('—', { timeout: 30_000 });
  const denyBuy = await api.post(`/api/chests/${newChestId}/keys`, {
    headers: { Authorization: `Bearer ${player.token}` },
    data: { idempotencyKey: `e2e-${run}-off-key` },
  });
  expect(denyBuy.status()).toBe(409);
  expect((await denyBuy.json()).errors.code).toBe('CHEST_NOT_FOR_SALE');

  // ---- Statistics and the log show the openings above.
  await admin.goto(`/admin/chests/${newChestId}?tab=thong-ke`);
  await admin.reload();
  await expect(admin.locator('[data-ac-stat="opens"]')).toHaveText('2');
  await expect(admin.locator('[data-ac-stat="keys"]')).not.toHaveText('0 xu');
  await shot(admin, 'thong-ke-7-ngay', true);
  await admin.locator('[data-ac-days="30"]').click();
  await expect(admin.locator('[data-ac-stat="opens"]')).toHaveText('2');

  await admin.goto('/admin/chests?tab=nhat-ky');
  await admin.reload();
  await admin.locator('[name="player"]').fill(run);
  await admin.locator('[name="chestId"]').selectOption(newChestId);
  await admin.locator('[data-ac-log-apply]').click();
  await expect(admin.locator('[data-opening]')).toHaveCount(2);
  await shot(admin, 'nhat-ky-mo-hom');

  // ---- Everything went through the audit log, with its reason.
  const audit = await call<{ items: Array<{ action: string; reason: string | null }> }>(api, 'GET', `/api/admin/audit?targetType=chest&targetId=${newChestId}`, adminAuth.token);
  expect(audit.items.map((entry) => entry.action)).toEqual(expect.arrayContaining(['chest.clone', 'chest.update']));
  expect(audit.items.some((entry) => entry.reason === 'Kết thúc kiểm thử')).toBe(true);
  const grants = await call<{ items: Array<{ reason: string | null }> }>(api, 'GET', `/api/admin/audit?action=chest.grant&targetId=${player.user.userId}`, adminAuth.token);
  expect(grants.items[0].reason).toBe('Kiểm thử cấp hòm');

  // ---- The same pages on a phone.
  const phone = await openAs(browser, adminAuth, { width: 390, height: 844 }, failures);
  const phonePages: Array<[string, string]> = [
    ['/admin/items', 'dien-thoai-vat-pham'],
    ['/admin/chests', 'dien-thoai-hom'],
    [`/admin/chests/${SEAL}?tab=thiet-lap`, 'dien-thoai-hom-thiet-lap'],
    [`/admin/chests/${SEAL}?tab=bang-roi`, 'dien-thoai-hom-bang-roi'],
    [`/admin/chests/${SEAL}?tab=lich-su`, 'dien-thoai-hom-lich-su'],
    [`/admin/chests/${newChestId}?tab=thong-ke`, 'dien-thoai-thong-ke'],
    ['/admin/chests?tab=nhat-ky', 'dien-thoai-nhat-ky'],
    ['/admin/chests?tab=cap', 'dien-thoai-cap-hom'],
  ];
  for (const [hash, name] of phonePages) {
    await phone.goto(hash);
    await phone.reload();
    await expect(phone.locator('.ac-page')).toBeVisible();
    await phone.waitForLoadState('networkidle');
    await shot(phone, name);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${hash} overflows sideways`).toBeLessThanOrEqual(0);
  }
  await phone.goto(`/admin/chests/${SEAL}`);
  await phone.reload();
  await phone.locator('[data-ac-preview]').click();
  await expect(phone.locator('.ac-preview #qh-caseName')).toHaveText('Hòm Niêm Phong');
  await shot(phone, 'dien-thoai-xem-thu');

  expect(failures, 'errors on the pages').toEqual([]);
});
