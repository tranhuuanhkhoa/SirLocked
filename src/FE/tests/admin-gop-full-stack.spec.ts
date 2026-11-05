import { mkdirSync } from 'node:fs';
import { expect, request, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * One round through all three admin areas against a running API (Development, loopback Mongo), as ADMIN-4 asks after merging them:
 * what one area makes has to work in the others. An admin and two detectives, each in their own browser:
 *   admin: an item with a picture goes in a chest and the odds change; a painted frame becomes the level 5 reward; a new title goes
 *          in a chest; a new entrance; a chest and key go to player A,
 *   A:     opens the chest and gets the new title, reaches level 5, wears the frame, the title and the entrance,
 *   B:     is in A's room when A arrives, and sees A's entrance and cosmetics,
 *   admin: coins for B, a listing removed, B's avatar removed, a stuck room closed, and all of it in the log.
 * Only two things are not real, because a local machine has no Cloudinary: the upload answer, and B's avatar, written into the test database.
 *
 *   npm i --no-save mongodb
 *   SIRLOCKED_RUN_ADMIN_GOP_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://127.0.0.1:5320 \
 *   SIRLOCKED_TEST_ADMIN_EMAIL=admin@sirlocked.local SIRLOCKED_TEST_ADMIN_PASSWORD=<local demo password> \
 *   SIRLOCKED_TEST_MONGO_URI=mongodb://127.0.0.1:27050 SIRLOCKED_TEST_MONGO_DB=SirLockedLocalDemo \
 *   SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5190 SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 \
 *   SIRLOCKED_ADMIN_EVIDENCE_DIR=../../tmp/admin-evidence/gop \
 *   node ./node_modules/@playwright/test/cli.js test tests/admin-gop-full-stack.spec.ts
 *
 * The API must run with Auth__AutoVerifyRegistrations=true. Changes the Seal chest of that database, so run it last.
 */
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string; fullName: string } };
type Progress = {
  level: number; frameDefId: string | null; titleDefId: string; entranceDefId: string;
  owned: Array<{ itemId: string; defId: string; source: string }>;
};

const enabled = process.env.SIRLOCKED_RUN_ADMIN_GOP_FULL_STACK === 'true';
const evidenceDir = process.env.SIRLOCKED_ADMIN_EVIDENCE_DIR;
const SEAL = 'chest_np';
const EPIC = 'VC-0405';
const PIXEL_CASE = 'case-pixel-tram-hong-ngoc-vi';
const ITEM_PICTURE = 'https://res.cloudinary.com/demo/image/upload/sirlocked/admin/gop-e2e.webp';
const FRAME_PICTURE = '/assets/cosmetics/vien-dong.webp';
const CREATURE_PICTURE = '/assets/cosmetics/phuong-bay.webp';
// A 96 x 96 gold square, written out so the test needs no image library.
const ITEM_PNG = Buffer.from(
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
    headers: { 'X-Forwarded-For': `10.82.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` },
  });
  const body = await response.text();
  expect(response.ok(), `register ${email}: ${body}`).toBe(true);
  return JSON.parse(body).data;
}

async function call<T = any>(api: APIRequestContext, method: string, path: string, token: string, data?: unknown): Promise<T> {
  const response = await api.fetch(path, { method, headers: { Authorization: `Bearer ${token}` }, data });
  const body = await response.text();
  expect(response.ok(), `${method} ${path}: ${body}`).toBe(true);
  return JSON.parse(body).data;
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

/** An <img> with size attributes counts as visible even when its file is broken, so ask whether it really decoded. */
async function expectPictureDrawn(picture: ReturnType<Page['locator']>) {
  // A list may redraw at any moment, and a lazy picture only loads once it is on screen: each attempt looks the picture up again.
  await expect.poll(async () => {
    try {
      await picture.scrollIntoViewIfNeeded({ timeout: 2000 });
      return await picture.evaluate((image: HTMLImageElement) => image.naturalWidth, undefined, { timeout: 2000 });
    } catch {
      return 0;
    }
  }, { timeout: 20_000 }).toBe(96);
}

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

async function confirmChest(page: Page, reason: string) {
  const dialog = page.locator('dialog.ac-dialog[open]');
  await dialog.locator('[name="reason"]').fill(reason);
  await dialog.locator('[data-ac-confirm]').click();
  await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);
}

const dialog = (page: Page) => page.locator('dialog[open]');

async function answer(page: Page, reason: string) {
  await dialog(page).getByLabel('Lý do').fill(reason);
  await dialog(page).locator('[data-confirm]').click();
}

const cleanups: Array<() => Promise<unknown>> = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => {});
});

test('một vòng qua cả 3 khu admin: hòm, mỹ phẩm, người chơi, nhật ký', async ({ browser }, testInfo) => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_ADMIN_GOP_FULL_STACK=true against a running loopback API.');
  test.setTimeout(600_000);
  if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  const { MongoClient } = await import('mongodb' as string);
  const mongo = new MongoClient(process.env.SIRLOCKED_TEST_MONGO_URI!);
  await mongo.connect();
  cleanups.push(() => mongo.close());
  const db = mongo.db(process.env.SIRLOCKED_TEST_MONGO_DB!);

  const api = await request.newContext({ baseURL: process.env.SIRLOCKED_TEST_API_URL });
  cleanups.push(() => api.dispose());
  const admin = await login(api, process.env.SIRLOCKED_TEST_ADMIN_EMAIL!, process.env.SIRLOCKED_TEST_ADMIN_PASSWORD!);
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const nameA = `Thám tử An ${run}`;
  const nameB = `Thám tử Bình ${run}`;
  const a = await register(api, nameA, `gop.an.${run}@tests.invalid`);
  const b = await register(api, nameB, `gop.binh.${run}@tests.invalid`);
  const failures: string[] = [];

  const openAs = async (who: Auth, viewport = { width: 1440, height: 900 }): Promise<{ page: Page; context: BrowserContext }> => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on('pageerror', (error) => failures.push(`${who.user.fullName}: ${error.message}`));
    await page.addInitScript((value) => {
      localStorage.setItem('sirlocked.token', value.token);
      localStorage.setItem('sirlocked.refreshToken', value.refreshToken);
      localStorage.setItem('sirlocked.refreshExpiry', value.refreshTokenExpiry);
      localStorage.setItem('sirlocked.user', JSON.stringify(value.user));
      localStorage.setItem('sirlocked.uiLanguage', 'vi');
    }, who);
    await context.route(ITEM_PICTURE, (route) => route.fulfill({ contentType: 'image/png', body: ITEM_PNG }));
    cleanups.push(() => context.close());
    return { page, context };
  };

  let number = 0;
  const shot = async (page: Page, name: string, fullPage = true) => {
    number += 1;
    const file = `${String(number).padStart(2, '0')}-${name}.png`;
    await page.waitForFunction(() => !document.querySelector('.bpa-rim, .bpa-lens'), undefined, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: evidenceDir ? `${evidenceDir}/${file}` : testInfo.outputPath(file), fullPage });
  };

  const { page: adminPage } = await openAs(admin);
  const { page: pageA } = await openAs(a);
  const { page: pageB } = await openAs(b);
  // The picture a local machine cannot store: the upload answers with what the next step expects.
  let uploadAnswer = { url: ITEM_PICTURE, width: 96, height: 96 };
  await adminPage.route((url) => url.pathname === '/api/admin/assets', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: uploadAnswer }),
  }));

  let itemId = '';
  let frameId = '';
  let titleId = '';
  let entranceId = '';
  let chestId = '';
  const itemName = `Bùa gộp ${run}`;
  const frameName = `Hắc Long ${run}`;
  const titleName = `Thần Thám ${run}`;
  const entranceName = `Hắc Long Giáng Thế ${run}`;
  const chestName = `Hòm Gộp ${run}`;

  await test.step('1. admin: vật phẩm có ảnh, thêm vào hòm, chỉnh tỉ lệ, lưu', async () => {
    await adminPage.goto('/admin/items');
    await expect(adminPage.locator('tr[data-item-id="VC-0217"]')).toBeVisible();
    await adminPage.locator('[data-ac-new-item]').click();
    const form = adminPage.locator('dialog.ac-dialog[open]');
    itemId = await form.locator('[data-ac-next-id]').innerText();
    await form.locator('[name="name"]').fill(itemName);
    await form.locator('[name="nameEn"]').fill(`Charm ${run}`);
    await form.locator('[name="description"]').fill('Một lá bùa tìm thấy ở hiện trường.');
    await form.locator('[name="descriptionEn"]').fill('A charm found at the scene.');
    await form.locator('[name="rarity"]').selectOption('RARE');
    await form.locator('[name="referencePrice"]').fill('500');
    await form.locator('input[type="file"]').setInputFiles({ name: 'bua.png', mimeType: 'image/png', buffer: ITEM_PNG });
    await expectPictureDrawn(form.locator(`[data-ac-image-preview][src="${ITEM_PICTURE}"]`));
    await shot(adminPage, 'admin-tao-vat-pham-co-anh', false);
    await form.locator('[data-ac-submit]').click();
    await expect(adminPage.locator(`tr[data-item-id="${itemId}"]`)).toContainText(itemName);

    await adminPage.goto(`/admin/chests/${SEAL}?tab=bang-roi`);
    await adminPage.reload();
    const common = adminPage.locator('input[data-weight="COMMON"]');
    const rare = adminPage.locator('input[data-weight="RARE"]');
    await expect(common).not.toHaveValue('');
    const commonBefore = Number(await common.inputValue());
    const rareBefore = Number(await rare.inputValue());
    await common.fill(String(Math.round((commonBefore - 1) * 100) / 100));
    await rare.fill(String(Math.round((rareBefore + 1) * 100) / 100));
    await adminPage.locator('[data-ac-add-item]').click();
    const picker = adminPage.locator('dialog.ac-dialog[open]');
    await picker.locator('[data-ac-pick-search]').fill(itemId);
    await picker.locator(`[data-pick-item="${itemId}"]`).click();
    await picker.locator('[data-ac-dialog-close]').click();
    await expect(adminPage.locator(`[data-pool-column="RARE"] [data-pool-item="${itemId}"]`)).toBeVisible();
    await shot(adminPage, 'admin-hom-them-vat-pham-chinh-ti-le');
    await adminPage.locator('[data-ac-save]').click();
    await confirmChest(adminPage, 'Thêm bùa, chỉnh tỉ lệ');
    await expect(adminPage.locator('[data-ac-save]')).toBeDisabled();
  });

  await test.step('2. admin: viền vẽ tay căn lỗ, có hiệu ứng, thưởng cấp 5', async () => {
    uploadAnswer = { url: FRAME_PICTURE, width: 247, height: 259 };
    await adminPage.goto('/admin/cosmetics');
    await expect(adminPage.locator('[data-card="frame_kimlong"]')).toBeVisible();
    await adminPage.locator('[data-new]').click();
    await adminPage.locator('#acf-name').fill(frameName);
    await adminPage.locator('#acf-name-en').fill(`Black Dragon ${run}`);
    await adminPage.locator('#acf-rarity').selectOption('EPIC');
    await adminPage.locator('[data-picture]').setInputFiles(await pictureFile(adminPage, FRAME_PICTURE, 'vien.png'));
    await expect(adminPage.locator('[data-align]')).toBeVisible();
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
    await adminPage.locator('[data-sheen="on"]').check();
    await adminPage.waitForTimeout(800);
    await shot(adminPage, 'admin-vien-ve-tay-can-lo-hieu-ung');
    await adminPage.locator('[data-save]').click();
    await expect(adminPage.locator('[data-acquisition]')).toBeVisible();
    frameId = decodeURIComponent((await adminPage.evaluate(() => window.location.pathname + window.location.search)).split('/').pop()!);
    await adminPage.locator('input[name="acf-mode"][value="level"]').check();
    await adminPage.locator('#acf-level').fill('5');
    await adminPage.locator('[data-save-way]').click();
    await adminPage.locator('#acf-reason').fill('Thưởng cấp 5');
    await adminPage.getByRole('dialog').locator('[data-confirm]').click();
    await expect(adminPage.locator('[data-field="tradable"]')).not.toBeChecked();
    await shot(adminPage, 'admin-vien-thuong-cap-5');
  });

  await test.step('3. admin: danh hiệu mới, cho vào hòm, hiện ở /admin/chests và /kho-ruong', async () => {
    await adminPage.goto('/admin/cosmetics/new?type=TITLE');
    await adminPage.locator('#acf-name').fill(titleName);
    await adminPage.locator('#acf-rarity').selectOption('MYSTERY');
    await adminPage.locator('[data-style="kimlong"]').click();
    await expect(adminPage.locator('[data-title-full] .hs-tl')).toHaveAttribute('aria-label', `Danh hiệu ${titleName}`);
    await adminPage.locator('#acf-price').fill('800');
    await adminPage.locator('[data-save]').click();
    await expect(adminPage.locator('[data-acquisition]')).toBeVisible();
    titleId = decodeURIComponent((await adminPage.evaluate(() => window.location.pathname + window.location.search)).split('/').pop()!);
    await shot(adminPage, 'admin-danh-hieu-moi');

    await adminPage.goto(`/admin/chests/${SEAL}?tab=bang-roi`);
    await adminPage.reload();
    await adminPage.locator('[data-ac-add-item]').click();
    const picker = adminPage.locator('dialog.ac-dialog[open]');
    await picker.locator('[data-ac-pick-search]').fill(titleId);
    await picker.locator(`[data-pick-item="${titleId}"]`).click();
    await picker.locator('[data-ac-dialog-close]').click();
    // Drawn by its own title style: this is what a plain sprite fallback would have got wrong.
    await expect(adminPage.locator(`[data-pool-column="MYSTERY"] [data-pool-item="${titleId}"] [data-ac-title-art]`)).toContainText(titleName);
    await shot(adminPage, 'admin-hom-co-danh-hieu-moi');
    await adminPage.locator('[data-ac-save]').click();
    await confirmChest(adminPage, 'Thêm danh hiệu');
    await expect(adminPage.locator('[data-ac-save]')).toBeDisabled();

    await pageA.goto('/kho-ruong');
    await expect(pageA.locator('#qh-caseName')).toHaveText('Hòm Niêm Phong');
    await expect(pageA.locator('#qh-contents .qh-it', { hasText: titleName })).toBeVisible();
    await expect(pageA.locator('#qh-contents .qh-it', { hasText: itemName })).toBeVisible();
    await shot(pageA, 'nguoi-choi-kho-ruong-thay-mon-moi');
  });

  await test.step('4. admin: hiệu ứng vào sảnh mới', async () => {
    uploadAnswer = { url: CREATURE_PICTURE, width: 247, height: 259 };
    await adminPage.goto('/admin/cosmetics/new?type=ENTRANCE');
    await adminPage.locator('#acf-name').fill(entranceName);
    await adminPage.locator('#acf-rarity').selectOption('LEGENDARY');
    await adminPage.locator('#acf-desc').fill('Rồng đen lượn qua mây.');
    await adminPage.locator('[data-template]').selectOption('kim-long');
    await adminPage.locator('[data-tint-on]').check();
    await adminPage.locator('[data-creature-input]').setInputFiles(await pictureFile(adminPage, CREATURE_PICTURE, 'sinh-vat.png'));
    await expect(adminPage.locator('[data-creature-status]')).toHaveText('Đang dùng ảnh riêng.');
    await adminPage.locator('[data-save]').click();
    await expect(adminPage.locator('[data-acquisition]')).toBeVisible();
    entranceId = decodeURIComponent((await adminPage.evaluate(() => window.location.pathname + window.location.search)).split('/').pop()!);
    await shot(adminPage, 'admin-hieu-ung-vao-sanh-moi');
  });

  await test.step('5. admin: một hòm chỉ ra danh hiệu mới, cấp hòm và chìa cho A', async () => {
    await adminPage.goto('/admin/chests');
    await adminPage.reload();
    await adminPage.locator(`[data-chest-id="${SEAL}"] [data-ac-clone]`).click();
    const clone = adminPage.locator('dialog.ac-dialog[open]');
    await clone.locator('[name="name"]').fill(chestName);
    await clone.locator('[name="nameEn"]').fill(`Merge Chest ${run}`);
    await clone.locator('[data-ac-confirm]').click();
    await expect(adminPage).toHaveURL(/\/admin\/chests\/chest_\d+/);
    chestId = decodeURIComponent(adminPage.url().split('/admin/chests/')[1].split('?')[0]);

    // Only the title can come out, so what the wheel gives below is known. The prices are there to pass the expected value rule.
    const detail = await call(api, 'GET', `/api/admin/chests/${chestId}`, admin.token);
    await call(api, 'PUT', `/api/admin/chests/${chestId}`, admin.token, {
      name: detail.name, nameEn: detail.nameEn, subtitle: detail.subtitle, subtitleEn: detail.subtitleEn, keyName: detail.keyName, keyNameEn: detail.keyNameEn,
      chestPrice: 3000, keyPrice: 3000, active: true, sortOrder: detail.sortOrder, look: detail.look,
      dropWeights: { COMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0, MYSTERY: 10000 }, pool: [titleId], expectedVersion: detail.version, reason: 'Hòm kiểm thử gộp',
    });

    await adminPage.goto('/admin/chests?tab=cap');
    await adminPage.reload();
    await adminPage.locator('[data-ac-player-search]').fill(`An ${run}`);
    await adminPage.locator(`[data-ac-player="${a.user.userId}"]`).click();
    await adminPage.locator('[name="chestId"]').selectOption(chestId);
    await adminPage.locator('[name="chests"]').fill('1');
    await adminPage.locator('[name="keys"]').fill('1');
    await shot(adminPage, 'admin-cap-hom-va-chia-cho-A');
    await adminPage.locator('[data-ac-grant]').click();
    await confirmChest(adminPage, 'Cấp hòm kiểm thử');
  });

  await test.step('6. A: mở hòm, ra đúng danh hiệu mới', async () => {
    await pageA.goto('/kho-ruong');
    await pageA.reload();
    await pageA.locator('.qh-dot').last().click();
    await expect(pageA.locator('#qh-caseName')).toHaveText(chestName);
    await expect(pageA.locator('#qh-nChest')).toHaveText('×1');
    await expect(pageA.locator('#qh-nKey')).toHaveText('1');
    await shot(pageA, 'A-truoc-khi-mo-hom', false);
    const opened = pageA.waitForResponse((response) => response.url().endsWith(`/api/chests/${chestId}/open`));
    await pageA.locator('#qh-openBtn').click();
    const body = (await (await opened).json()).data;
    expect(body.item.id).toBe(titleId);
    await expect(pageA.locator('#qh-gotName')).toHaveText(titleName, { timeout: 45_000 });
    await shot(pageA, 'A-mo-hom-ra-danh-hieu-moi', false);
    await pageA.locator('#qh-keepBtn').click();
  });

  await test.step('7. A: đổi KN lên cấp 5, nhận viền, trang bị viền, danh hiệu, hiệu ứng', async () => {
    const adminGrant = (auth: Auth, defId: string) => call(api, 'POST', `/api/admin/players/${auth.user.userId}/items`, admin.token, {
      defId, reason: 'Chuẩn bị kiểm thử', idempotencyKey: `gop-${run}-${Math.random().toString(36).slice(2, 10)}`,
    });
    await adminGrant(a, EPIC);
    await adminGrant(a, EPIC);
    await call(api, 'POST', `/api/admin/cosmetics/${entranceId}/grant`, admin.token, { userId: a.user.userId, reason: 'Quà kiểm thử' });

    await pageA.goto('/detective');
    await expect(pageA.locator('#hs-p-doi')).toContainText('Đổi tất cả');
    await pageA.getByRole('button', { name: /Đổi tất cả/ }).click();
    await pageA.getByRole('dialog').locator('[data-ok]').click();
    const unlock = pageA.getByRole('dialog');
    // An interrupted earlier run may have left a level 5 reward of its own: each new frame has its own screen.
    for (;;) {
      await expect(unlock).toContainText('Cấp 5 · mở khóa viền mới');
      if ((await unlock.textContent())?.includes(frameName)) break;
      const previous = await unlock.textContent();
      await unlock.locator('[data-close]').click();
      await expect(unlock).not.toHaveText(previous ?? '');
    }
    await shot(pageA, 'A-len-cap-5-mo-khoa-vien', false);
    await unlock.locator('[data-use]').click();
    await expect.poll(async () => (await call<Progress>(api, 'GET', '/api/progress/me', a.token)).frameDefId).toBe(frameId);
    const me = await call<Progress>(api, 'GET', '/api/progress/me', a.token);
    expect(me.level).toBe(5);
    expect(me.owned.find((item) => item.defId === titleId)?.source).toBe('CHEST');

    await pageA.goto('/detective');
    await pageA.reload();
    await pageA.getByRole('tab', { name: 'Danh hiệu' }).click();
    const plaque = pageA.locator(`[data-hs-title-id="${titleId.replace('title_', '')}"]`);
    await expect(plaque.locator('.hs-tl')).toHaveAttribute('aria-label', `Danh hiệu ${titleName}`);
    await plaque.click();
    await expect.poll(async () => (await call<Progress>(api, 'GET', '/api/progress/me', a.token)).titleDefId).toBe(titleId);

    await pageA.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();
    const entrance = pageA.locator(`[data-hs-entrance="${entranceId.replace('entrance_', '')}"]`);
    await entrance.locator('[data-use]').click();
    await expect(entrance.locator('[data-use]')).toHaveText('Đang dùng');
    await expect.poll(async () => (await call<Progress>(api, 'GET', '/api/progress/me', a.token)).entranceDefId).toBe(entranceId);
    await shot(pageA, 'A-trang-bi-du-ba-mon', false);
  });

  let roomCode = '';
  await test.step('8. B: có mặt trong phòng của A, thấy hiệu ứng vào sảnh và mỹ phẩm của A', async () => {
    const room = await call(api, 'POST', '/api/rooms', a.token, { caseId: PIXEL_CASE, visibility: 'PRIVATE' });
    roomCode = room.roomCode;
    await call(api, 'POST', '/api/rooms/join', b.token, { roomCode });
    await pageB.goto(`/lobby/${room.roomId}`);
    await expect(pageB.locator('.bpa-lobby-pair')).toBeVisible();
    await expect(pageB.locator(`[data-seat-user="${b.user.userId}"]`)).toBeVisible();
    // B wears the default entrance, which is only a mist over the seat. Give B's connection time to join the room's group.
    await pageB.waitForTimeout(3000);

    // A arrives while B is already watching.
    const stageB = pageB.locator('.hs-stage:not(.hs-out)');
    await pageA.goto(`/lobby/${room.roomId}`);
    await expect(stageB.locator('.hs-hn')).toHaveText(nameA);
    await expect(stageB.locator('.hs-hero small')).toHaveText(`đã vào sảnh · ${entranceName}`);
    await expect(stageB.locator('.hs-tl')).toHaveAttribute('aria-label', `Danh hiệu ${titleName}`);
    await pageB.waitForTimeout(3000);
    await shot(pageB, 'B-thay-hieu-ung-vao-sanh-cua-A', false);
    await pageB.getByRole('button', { name: 'Bỏ qua' }).click();
    await expect(pageB.locator('.hs-stage')).toHaveCount(0);

    const seatA = pageB.locator(`[data-seat-user="${a.user.userId}"]`);
    await expect(seatA.locator('.hs-tl')).toHaveAttribute('aria-label', `Danh hiệu ${titleName}`);
    await expect.poll(() => seatPaintsFrame(pageB, a.user.userId, frameId)).toBe(true);
    await pageB.waitForTimeout(800);
    await shot(pageB, 'B-thay-vien-va-danh-hieu-cua-A', false);
  });

  await test.step('kiểm tra chéo: món có ảnh hiện ở kho, Chợ đồ, trang người chơi của admin', async () => {
    await adminPage.goto(`/admin/players/${b.user.userId}`);
    await expect(adminPage.getByRole('heading', { name: nameB })).toBeVisible();
    await adminPage.getByRole('button', { name: 'Cấp vật phẩm' }).click();
    await dialog(adminPage).getByLabel('Vật phẩm').selectOption(itemId);
    await answer(adminPage, 'Quà kiểm thử');
    await expect(dialog(adminPage)).toHaveCount(0);
    const row = adminPage.locator('[data-adp-panel="kho"] tr', { hasText: itemName });
    await expect(row).toBeVisible();
    await expectPictureDrawn(row.locator(`img[src="${ITEM_PICTURE}"]`));
    await shot(adminPage, 'admin-trang-nguoi-choi-mon-co-anh');

    await pageB.goto('/market/sell');
    await pageB.reload();
    await expectPictureDrawn(pageB.locator('.bpa-mk-inv', { hasText: itemName }).locator(`img[src="${ITEM_PICTURE}"]`));
    await shot(pageB, 'B-kho-do-mon-co-anh', false);

    const owned = await call(api, 'GET', '/api/market/inventory', b.token);
    const mine = owned.items.find((entry: { def: { id: string } }) => entry.def.id === itemId);
    await call(api, 'POST', '/api/market/listings', b.token, { itemId: mine.itemId, price: 600, requestId: `gop-${run}-list` });
    await pageB.goto('/market');
    await pageB.locator('.bpa-mk-cat[data-category="CURIO"]').click();
    await expectPictureDrawn(pageB.locator(`#mk-rows [data-def="${itemId}"] img[src="${ITEM_PICTURE}"]`));
    await shot(pageB, 'B-cho-do-mon-co-anh', false);
  });

  await test.step('9. admin: cộng xu cho B, gỡ listing, xóa avatar của B, đóng phòng treo', async () => {
    const balanceBefore = (await call(api, 'GET', '/api/market/me', b.token)).balance as number;
    await adminPage.goto(`/admin/players/${b.user.userId}`);
    await adminPage.reload();
    await adminPage.getByRole('button', { name: 'Cộng / trừ xu' }).click();
    await dialog(adminPage).getByLabel('Số xu').fill('250');
    await answer(adminPage, 'Bù lỗi sự kiện');
    await expect(dialog(adminPage)).toHaveCount(0);
    expect((await call(api, 'GET', '/api/market/me', b.token)).balance).toBe(balanceBefore + 250);
    await shot(adminPage, 'admin-cong-xu-cho-B');

    await adminPage.goto('/admin/economy?tab=cho');
    const filter = adminPage.locator('[data-adp-listings-filter]');
    await filter.getByLabel('Người bán').fill(nameB);
    await filter.getByRole('button', { name: 'Lọc' }).click();
    const listing = adminPage.locator('[data-adp-listings] tbody tr').filter({ hasText: nameB });
    await expect(listing).toHaveCount(1);
    await expectPictureDrawn(listing.locator(`img[src="${ITEM_PICTURE}"]`));
    await shot(adminPage, 'admin-tin-rao-cua-B');
    await listing.getByRole('button', { name: 'Gỡ' }).click();
    await answer(adminPage, 'Gỡ thử');
    await expect(adminPage.locator('[data-adp-listings]').getByText(nameB)).toHaveCount(0);

    // The upload itself needs Cloudinary. Everything after it is real.
    const picture = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
    await call(api, 'GET', '/api/progress/me', b.token);
    await db.collection('playerProgress').updateOne({ _id: b.user.userId as never }, { $set: { avatar: 'upload', avatarUrl: picture, avatarUploadedAt: new Date() } });
    await adminPage.goto('/admin/players?tab=anh');
    await adminPage.reload();
    const card = adminPage.locator('[data-adp-avatar]', { hasText: nameB });
    await expect(card.locator('img')).toBeVisible();
    await card.getByRole('button', { name: 'Xóa ảnh' }).click();
    await dialog(adminPage).getByRole('button', { name: 'Ảnh phản cảm' }).click();
    await dialog(adminPage).locator('[data-confirm]').click();
    await expect(card).toHaveCount(0);
    const profile = await call(api, 'GET', '/api/progress/me', b.token);
    expect(profile.avatar).toBe('nonla');
    expect(profile.avatarUrl).toBeNull();
    await shot(adminPage, 'admin-da-xoa-avatar-cua-B');

    await adminPage.goto('/admin/economy?tab=phong');
    const panel = adminPage.locator('[data-adp-economy="phong"]');
    const room = panel.locator('tbody tr', { hasText: roomCode });
    await expect(room).toBeVisible();
    await shot(adminPage, 'admin-phong-treo');
    await room.getByRole('button', { name: 'Đóng phòng' }).click();
    await answer(adminPage, 'Phòng treo');
    await expect(panel.getByText(roomCode)).toHaveCount(0);
    await expect(pageA.getByText('Phòng này đã kết thúc')).toBeVisible();
    await shot(pageA, 'A-thay-phong-da-dong', false);
  });

  await test.step('kiểm tra chéo: thao tác của cả 3 khu đều có trong nhật ký', async () => {
    const log = await call<{ items: Array<{ action: string; targetId: string; reason: string | null }> }>(api, 'GET', '/api/admin/audit?pageSize=200', admin.token);
    const seen = (action: string, targetId: string) => log.items.some((entry) => entry.action === action && entry.targetId === targetId);
    // Hòm & vật phẩm.
    expect(seen('item.create', itemId), 'item.create').toBe(true);
    expect(seen('chest.update', SEAL), 'chest.update').toBe(true);
    expect(seen('chest.clone', chestId), 'chest.clone').toBe(true);
    expect(seen('chest.grant', a.user.userId), 'chest.grant').toBe(true);
    // Mỹ phẩm.
    expect(seen('item.create', frameId), 'cosmetic item.create').toBe(true);
    expect(seen('item.acquisition', frameId), 'item.acquisition').toBe(true);
    expect(seen('player.grant', a.user.userId), 'player.grant').toBe(true);
    // Người chơi và kinh tế.
    expect(seen('player.coins', b.user.userId), 'player.coins').toBe(true);
    expect(seen('player.avatar.remove', b.user.userId), 'player.avatar.remove').toBe(true);
    expect(log.items.some((entry) => entry.action === 'listing.remove' && entry.reason === 'Gỡ thử'), 'listing.remove').toBe(true);
    expect(log.items.some((entry) => entry.action === 'room.close' && entry.reason === 'Phòng treo'), 'room.close').toBe(true);
    expect(JSON.stringify(log.items)).not.toMatch(/passwordHash|refreshToken|verificationToken/i);

    await adminPage.goto('/admin/audit');
    await expect(adminPage.locator('[data-adp-audit] tbody tr').first()).toBeVisible();
    await shot(adminPage, 'admin-nhat-ky-tat-ca');
    const form = adminPage.locator('[data-adp-audit-filter]');
    for (const [action, target, name] of [['item.acquisition', frameId, 'my-pham'], ['chest.grant', a.user.userId, 'hom'], ['player.coins', b.user.userId, 'nguoi-choi']]) {
      await form.getByLabel('Thao tác').fill(action);
      await form.getByLabel('Mã đối tượng').fill(target);
      await form.getByRole('button', { name: 'Lọc' }).click();
      await expect(adminPage.locator('[data-adp-audit] tbody tr').filter({ hasText: action })).toHaveCount(1);
      await shot(adminPage, `admin-nhat-ky-loc-${name}`);
    }
    // The filter suggests what all three areas write.
    const suggested = await adminPage.locator('#adp-a-actions option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(suggested).toEqual(expect.arrayContaining(['item.acquisition', 'chest.grant', 'player.coins', 'gameSettings.update']));
  });

  await test.step('kiểm tra chéo: mọi tab admin mở được', async () => {
    const tabs = await adminPage.evaluate(async () => (await import('/Client/js/components/adminNav.js' as string)).ADMIN_TABS.map((tab: { href: string; label: string }) => ({ href: tab.href, label: tab.label })));
    expect(tabs.length).toBeGreaterThanOrEqual(9);
    for (const tab of tabs) {
      await adminPage.goto(tab.href);
      await expect(adminPage.locator('.admin-nav-tab.is-active')).toHaveText(tab.label);
      await expect(adminPage.locator('#app')).not.toContainText('Đang xây dựng');
    }
  });

  await test.step('màn 390x844', async () => {
    const check = async (page: Page, hash: string, name: string) => {
      await page.goto(hash);
      await page.waitForFunction(() => !document.querySelector('.bpa-rim, .bpa-lens'), undefined, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(900);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${hash} scrolls sideways`).toBeLessThanOrEqual(0);
      await shot(page, `dien-thoai-${name}`, false);
    };
    const { page: phoneAdmin } = await openAs(admin, { width: 390, height: 844 });
    for (const [hash, name] of [
      ['/admin', 'tong-quan'],
      ['/admin/items', 'vat-pham'],
      ['/admin/chests', 'hom'],
      [`/admin/chests/${SEAL}?tab=bang-roi`, 'hom-bang-roi'],
      ['/admin/cosmetics', 'my-pham'],
      [`/admin/cosmetics/${encodeURIComponent(frameId)}`, 'my-pham-vien-moi'],
      ['/admin/players', 'nguoi-choi'],
      [`/admin/players/${b.user.userId}`, 'nguoi-choi-chi-tiet'],
      ['/admin/economy', 'kinh-te'],
      ['/admin/audit', 'nhat-ky'],
    ]) await check(phoneAdmin, hash, name);
    const { page: phoneA } = await openAs(a, { width: 390, height: 844 });
    await check(phoneA, '/kho-ruong', 'kho-ruong');
    await check(phoneA, '/detective', 'ho-so');
    await check(phoneA, '/market', 'cho-do');
  });

  expect(failures, 'no page threw an error').toEqual([]);
});
