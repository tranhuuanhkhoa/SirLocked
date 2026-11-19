import { expect, request, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * The player, economy and audit admin end to end against a running API (Development, loopback Mongo), with an admin and two
 * real detectives each in their own browser. A picture upload needs Cloudinary, and a stuck operation needs a crash, so those
 * two are written straight into the test database:
 *
 *   npm i --no-save mongodb
 *   SIRLOCKED_RUN_ADMIN_PLAYERS_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://127.0.0.1:5313 \
 *   SIRLOCKED_TEST_ADMIN_EMAIL=admin@sirlocked.local SIRLOCKED_TEST_ADMIN_PASSWORD=LocalDemo123! \
 *   SIRLOCKED_TEST_MONGO_URI=mongodb://127.0.0.1:27033 SIRLOCKED_TEST_MONGO_DB=SirLockedLocalDemo \
 *   SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5183 SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 \
 *   SIRLOCKED_ADMIN_EVIDENCE_DIR=../../tmp/admin-evidence/feat/admin-nguoi-choi \
 *   npx playwright test tests/admin-players/full-stack.spec.ts
 *
 * The API must run with Auth__AutoVerifyRegistrations=true. Each run registers two fresh users, and writes only to that local database.
 */
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string; fullName: string } };

const enabled = process.env.SIRLOCKED_RUN_ADMIN_PLAYERS_FULL_STACK === 'true';
const evidenceDir = process.env.SIRLOCKED_ADMIN_EVIDENCE_DIR;
const RARE = 'VC-0391';
const PIXEL_CASE = 'case-pixel-tram-hong-ngoc-vi';

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
    headers: { 'X-Forwarded-For': `10.81.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
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

async function openAs(browser: Browser, auth: Auth, failures: string[], viewport = { width: 1440, height: 900 }): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  await page.addInitScript((value) => {
    localStorage.setItem('sirlocked.token', value.token);
    localStorage.setItem('sirlocked.refreshToken', value.refreshToken);
    localStorage.setItem('sirlocked.refreshExpiry', value.refreshTokenExpiry);
    localStorage.setItem('sirlocked.user', JSON.stringify(value.user));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
  }, auth);
  return { page, context };
}

const dialog = (page: Page) => page.locator('dialog[open]');
const confirm = (page: Page) => dialog(page).locator('[data-confirm]');

async function answer(page: Page, reason: string) {
  await dialog(page).getByLabel('Lý do').fill(reason);
  await confirm(page).click();
}

// Several sessions share this machine, and a page under load can take longer than the default ten seconds to answer.
expect.configure({ timeout: 30_000 });

// A failed step must not leave a connection or a browser open behind it, or the worker waits on them until the timeout.
const cleanups: Array<() => Promise<unknown>> = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => {});
});

test('một vòng quản trị đầy đủ: xu, vật phẩm, cấp, ảnh, chợ, phòng, đánh giá, kẹt, nhật ký', async ({ browser }, testInfo) => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_ADMIN_PLAYERS_FULL_STACK=true against a running loopback API.');
  test.setTimeout(420_000);
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
  const a = await register(api, nameA, `an.${run}@tests.invalid`);
  const b = await register(api, nameB, `binh.${run}@tests.invalid`);
  const failures: string[] = [];

  const { page: adminPage, context: adminContext } = await openAs(browser, admin, failures);
  const { page: playerPage, context: playerContext } = await openAs(browser, a, failures);
  cleanups.push(() => adminContext.close(), () => playerContext.close());
  const shot = async (page: Page, name: string) => {
    const path = evidenceDir ? `${evidenceDir}/${name}.png` : testInfo.outputPath(`${name}.png`);
    // The route's lens plays over every page for a moment.
    await page.waitForFunction(() => !document.querySelector('.bpa-rim, .bpa-lens'), undefined, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
    await page.waitForTimeout(200);
    await page.screenshot({ path, fullPage: true });
  };
  const key = () => `fs-${run}-${Math.random().toString(36).slice(2, 10)}`;
  const adminGrant = (auth: Auth, defId: string) => call(api, 'POST', `/api/admin/players/${auth.user.userId}/items`, admin.token, { defId, reason: 'Chuẩn bị kiểm thử', idempotencyKey: key() });

  await test.step('tổng quan có thẻ số liệu dẫn đúng trang', async () => {
    await adminPage.goto('/admin');
    const cards = adminPage.locator('[data-adp-cards]');
    await expect(cards.getByRole('link', { name: /Ảnh chờ duyệt/ })).toBeVisible();
    await expect(cards.getByRole('link', { name: /Người chơi mới/ })).toContainText(/[1-9]/);
    await shot(adminPage, '01-tong-quan-the-so-lieu');
  });

  await test.step('tìm người chơi, cộng xu, thấy số dư đổi ở /market của người đó', async () => {
    await playerPage.goto('/market');
    await expect(playerPage.locator('[data-mk-balance]')).toHaveText('500');

    await adminPage.goto('/admin/players');
    await adminPage.getByRole('searchbox', { name: 'Tìm người chơi' }).fill(`An ${run}`);
    await adminPage.getByRole('button', { name: 'Tìm', exact: true }).click();
    const row = adminPage.locator('.adp-table tbody tr', { hasText: nameA });
    await expect(row).toHaveCount(1);
    await shot(adminPage, '02-tim-nguoi-choi');
    await row.getByRole('link', { name: nameA }).click();
    await expect(adminPage.getByRole('heading', { name: nameA })).toBeVisible();
    await shot(adminPage, '03-chi-tiet-nguoi-choi');

    await adminPage.getByRole('button', { name: 'Cộng / trừ xu' }).click();
    await dialog(adminPage).getByLabel('Số xu').fill('250');
    await shot(adminPage, '04-hop-cong-xu');
    await answer(adminPage, 'Bù lỗi sự kiện');
    await expect(dialog(adminPage)).toHaveCount(0);
    await expect(adminPage.locator('[data-adp-summary]')).toContainText('750');

    await playerPage.reload();
    await expect(playerPage.locator('[data-mk-balance]')).toHaveText('750');
    await shot(playerPage, '05-so-du-o-cho-sau-khi-cong');
  });

  await test.step('trừ quá số dư bị từ chối, số dư giữ nguyên', async () => {
    await adminPage.getByRole('button', { name: 'Cộng / trừ xu' }).click();
    await dialog(adminPage).getByLabel('Số xu').fill('-100000');
    await answer(adminPage, 'Phạt gian lận');
    await expect(dialog(adminPage).getByRole('alert')).toContainText('không đủ xu');
    await shot(adminPage, '06-tru-qua-so-du-bi-tu-choi');
    await dialog(adminPage).getByRole('button', { name: 'Hủy' }).click();
    const wallet = await call(api, 'GET', '/api/market/me', a.token);
    expect(wallet.balance).toBe(750);
  });

  await test.step('cấp vật phẩm, rồi thu hồi món đang trang bị', async () => {
    await adminPage.getByRole('button', { name: 'Cấp vật phẩm' }).click();
    await dialog(adminPage).getByLabel('Vật phẩm').selectOption(RARE);
    await answer(adminPage, 'Quà sự kiện');
    await expect(dialog(adminPage)).toHaveCount(0);
    await expect(adminPage.locator('[data-adp-panel="kho"] tr', { hasText: 'Đèn bão' })).toBeVisible();

    const worn = await call(api, 'POST', `/api/admin/players/${a.user.userId}/items`, admin.token, { defId: 'frame_dong', reason: 'Chuẩn bị kiểm thử', idempotencyKey: key() });
    await call(api, 'POST', `/api/market/inventory/${worn.itemId}/equip`, a.token);
    await adminPage.reload();
    await expect(adminPage.locator('[data-adp-panel="kho"] tr', { hasText: 'Đang dùng' })).toBeVisible();
    await shot(adminPage, '07-kho-do-co-mon-dang-dung');
    await adminPage.locator('[data-adp-panel="kho"] tr', { hasText: 'Đang dùng' }).getByRole('button', { name: /Thu hồi/ }).click();
    await expect(dialog(adminPage)).toContainText('gỡ trang bị');
    await answer(adminPage, 'Cấp nhầm viền');
    await expect(dialog(adminPage)).toHaveCount(0);
    const inventory = await call(api, 'GET', '/api/market/inventory', a.token);
    expect(inventory.items.some((item: { itemId: string }) => item.itemId === worn.itemId)).toBe(false);
    expect(Object.values(inventory.equipped)).not.toContain(worn.itemId);
  });

  await test.step('thu hồi món đang trao đổi bị từ chối', async () => {
    const offered = await adminGrant(a, RARE);
    await call(api, 'POST', '/api/market/trades', a.token, { toUserId: b.user.userId, offerItemIds: [offered.itemId], requestItemIds: [], offerCoins: 0, requestCoins: 0, message: '' });
    await adminPage.reload();
    const row = adminPage.locator('[data-adp-panel="kho"] tr', { hasText: 'Trong đề nghị trao đổi' });
    await row.getByRole('button', { name: /Thu hồi/ }).click();
    await answer(adminPage, 'Thử thu hồi');
    await expect(dialog(adminPage).getByRole('alert')).toContainText('đề nghị trao đổi');
    await shot(adminPage, '08-thu-hoi-mon-dang-trao-doi-bi-tu-choi');
    await dialog(adminPage).getByRole('button', { name: 'Hủy' }).click();
    const inventory = await call(api, 'GET', '/api/market/inventory', a.token);
    expect(inventory.items.some((item: { itemId: string }) => item.itemId === offered.itemId)).toBe(true);
  });

  await test.step('đặt cấp: phần thưởng cấp bù đúng một lần, hạ cấp không thu hồi', async () => {
    await adminPage.getByRole('button', { name: 'Đặt cấp / KN' }).click();
    await dialog(adminPage).getByLabel('Cấp', { exact: true }).fill('10');
    await dialog(adminPage).getByLabel('KN', { exact: true }).fill('5');
    await answer(adminPage, 'Hỗ trợ người chơi');
    await expect(dialog(adminPage)).toHaveCount(0);
    await expect(adminPage.locator('#toast-root')).toContainText('frame_dong');
    await expect(adminPage.locator('[data-adp-summary]')).toContainText('10');
    await shot(adminPage, '09-dat-cap-cap-bu-thuong');

    const me = await call(api, 'GET', '/api/progress/me', a.token);
    expect(me.level).toBe(10);
    expect(me.owned.filter((item: { defId: string; source: string }) => item.defId === 'frame_dong' && item.source === 'LEVEL')).toHaveLength(1);

    await adminPage.getByRole('button', { name: 'Đặt cấp / KN' }).click();
    await dialog(adminPage).getByLabel('Cấp', { exact: true }).fill('5');
    await dialog(adminPage).getByLabel('KN', { exact: true }).fill('0');
    await answer(adminPage, 'Sửa lại cho đúng');
    await expect(dialog(adminPage)).toHaveCount(0);
    await expect(adminPage.locator('#toast-root')).toContainText('vẫn giữ');
    const lowered = await call(api, 'GET', '/api/progress/me', a.token);
    expect(lowered.level).toBe(5);
    expect(lowered.owned.some((item: { defId: string }) => item.defId === 'frame_dong')).toBe(true);
  });

  await test.step('xóa ảnh đại diện từ lưới duyệt ảnh, người chơi về ảnh mẫu', async () => {
    // The upload itself needs Cloudinary. Everything after it is real.
    const picture = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
    await call(api, 'GET', '/api/progress/me', b.token);
    await db.collection('playerProgress').updateOne({ _id: b.user.userId as never }, { $set: { avatar: 'upload', avatarUrl: picture, avatarUploadedAt: new Date() } });
    expect((await call(api, 'GET', '/api/progress/me', b.token)).avatarUrl).toBe(picture);

    await adminPage.goto('/admin/players?tab=anh');
    const card = adminPage.locator('[data-adp-avatar]', { hasText: nameB });
    await expect(card.locator('img')).toBeVisible();
    await shot(adminPage, '10-luoi-duyet-anh');
    await card.getByRole('button', { name: 'Xóa ảnh' }).click();
    await dialog(adminPage).getByRole('button', { name: 'Ảnh phản cảm' }).click();
    await shot(adminPage, '11-hop-xoa-anh-ly-do-co-san');
    await confirm(adminPage).click();
    await expect(card).toHaveCount(0);

    const me = await call(api, 'GET', '/api/progress/me', b.token);
    expect(me.avatar).toBe('nonla');
    expect(me.avatarUrl).toBeNull();
    const { page: playerB, context: contextB } = await openAs(browser, b, failures);
    await playerB.goto('/detective');
    await expect(playerB.locator('.hs-name')).toBeVisible();
    await shot(playerB, '12-nguoi-choi-ve-anh-mau');
    await contextB.close();
  });

  const reference = (await call(api, 'GET', '/api/market/catalog', a.token)).find((def: { id: string }) => def.id === RARE).referencePrice as number;

  await test.step('gỡ listing: vật phẩm về lại người bán, không ai mất xu', async () => {
    const sold = await adminGrant(a, RARE);
    const listing = await call(api, 'POST', '/api/market/listings', a.token, { itemId: sold.itemId, price: reference * 20 });
    const before = (await call(api, 'GET', '/api/market/me', a.token)).balance;

    await adminPage.goto('/admin/economy?tab=cho');
    const filter = adminPage.locator('[data-adp-listings-filter]');
    await filter.getByLabel('Người bán').fill(nameA);
    await filter.getByRole('button', { name: 'Lọc' }).click();
    const row = adminPage.locator('[data-adp-listings] tbody tr').filter({ hasText: nameA });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Giá cao bất thường');
    await shot(adminPage, '13-cho-tin-rao-gia-bat-thuong');

    await adminPage.goto('/admin/economy?tab=batthuong');
    await expect(adminPage.locator('[data-adp-economy="batthuong"]').getByRole('link', { name: nameA }).first()).toBeVisible();
    await shot(adminPage, '14-canh-bao-bat-thuong');

    await adminPage.goto('/admin/economy?tab=cho');
    await filter.getByLabel('Người bán').fill(nameA);
    await filter.getByRole('button', { name: 'Lọc' }).click();
    await row.getByRole('button', { name: 'Gỡ' }).click();
    await answer(adminPage, 'Giá bất thường');
    await expect(adminPage.locator('[data-adp-listings]').getByText(nameA)).toHaveCount(0);
    await shot(adminPage, '15-da-go-tin-rao');

    const inventory = await call(api, 'GET', '/api/market/inventory', a.token);
    const item = inventory.items.find((entry: { itemId: string }) => entry.itemId === sold.itemId);
    expect(item.locked).toBe(false);
    expect((await call(api, 'GET', '/api/market/me', a.token)).balance).toBe(before);
    expect(listing.listing.listingId).toBeTruthy();
  });

  await test.step('hủy lệnh mua: trả đúng số xu đang giữ', async () => {
    const before = await call(api, 'GET', '/api/market/me', a.token);
    await call(api, 'POST', '/api/market/orders', a.token, { defId: 'VC-0405', price: 77 });
    expect((await call(api, 'GET', '/api/market/me', a.token)).held).toBe(before.held + 77);

    const filter = adminPage.locator('[data-adp-orders-filter]');
    await filter.getByLabel('Người mua').fill(nameA);
    await filter.getByRole('button', { name: 'Lọc' }).click();
    const row = adminPage.locator('[data-adp-orders] tbody tr').filter({ hasText: nameA });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Hủy lệnh' }).click();
    await answer(adminPage, 'Lệnh mua giá ảo');
    await expect(adminPage.locator('[data-adp-orders]').getByText(nameA)).toHaveCount(0);
    const after = await call(api, 'GET', '/api/market/me', a.token);
    expect(after.balance).toBe(before.balance);
    expect(after.held).toBe(before.held);
  });

  await test.step('lịch sử bán và xuất CSV', async () => {
    const forSale = await adminGrant(a, RARE);
    await call(api, 'POST', '/api/market/listings', a.token, { itemId: forSale.itemId, price: 100 });
    const listed = (await call(api, 'GET', '/api/market/mine', a.token)).listings.find((entry: { itemId: string }) => entry.itemId === forSale.itemId);
    await call(api, 'POST', `/api/market/listings/${listed.listingId}/buy`, b.token);

    await adminPage.goto('/admin/economy?tab=lichsu');
    const filter = adminPage.locator('[data-adp-sales-filter]');
    await filter.getByLabel('Người mua hoặc bán').fill(nameB);
    await filter.getByRole('button', { name: 'Lọc' }).click();
    await expect(adminPage.locator('[data-adp-sales] tbody tr')).toHaveCount(1);
    const download = adminPage.waitForEvent('download');
    await adminPage.getByRole('button', { name: 'Xuất CSV' }).click();
    const file = await download;
    const content = await (await file.createReadStream()).toArray();
    const text = Buffer.concat(content).toString('utf8');
    expect(text).toContain(nameB);
    expect(text).toContain('at,defId,name,price');
    await shot(adminPage, '16-lich-su-ban-va-trao-doi');
  });

  await test.step('tổng quan kinh tế cộng đúng', async () => {
    await adminPage.goto('/admin/economy');
    const panel = adminPage.locator('[data-adp-economy="tongquan"]');
    await expect(panel.locator('[data-adp-flow] tbody tr')).toHaveCount(7);
    await shot(adminPage, '17-kinh-te-tong-quan-7-ngay');
    await panel.getByRole('button', { name: '30 ngày' }).click();
    await expect(panel.locator('[data-adp-flow] tbody tr')).toHaveCount(30);
  });

  await test.step('giao dịch kẹt được phát hiện và chạy khôi phục', async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    await call(api, 'POST', '/api/chests/admin/grant', admin.token, { userId: b.user.userId, chestId: 'chest_np', chests: 1, keys: 1 });
    const stuckId = `${b.user.userId}:stuck-${run}`;
    await db.collection('chestOpenings').insertOne({
      _id: stuckId as never, userId: b.user.userId, chestDefId: 'chest_np', keyDefId: 'key_np', rewardDefId: RARE,
      rewardItemId: `${run}${'0'.repeat(24)}`.slice(0, 24), state: 'PENDING', committed: false, createdAt: old, updatedAt: old,
    });
    // The worker sweeps every 30 seconds, so a stuck row can be gone before the page opens. Reads as "listed, or already finished".
    await adminPage.goto('/admin/economy?tab=ket');
    const panel = adminPage.locator('[data-adp-economy="ket"]');
    await expect(panel.locator('[data-adp-stuck]')).not.toContainText('Đang tải');
    await shot(adminPage, '18-giao-dich-ket');
    await panel.getByRole('button', { name: 'Chạy khôi phục' }).click();
    await answer(adminPage, 'Chạy tay sau sự cố');
    await expect(dialog(adminPage)).toHaveCount(0);
    await expect.poll(async () => (await db.collection('chestOpenings').findOne({ _id: stuckId as never }))?.state, { timeout: 40_000 }).toBe('DONE');
    await adminPage.reload();
    await expect(panel.getByText('Không có giao dịch nào bị kẹt')).toBeVisible();
    await shot(adminPage, '19-da-khoi-phuc');
  });

  await test.step('đóng phòng chờ: người trong phòng được báo qua SignalR', async () => {
    const room = await call(api, 'POST', '/api/rooms', a.token, { caseId: PIXEL_CASE, visibility: 'PRIVATE' });
    await playerPage.goto(`/lobby/${room.roomId}`);
    await expect(playerPage.locator('.bpa-lobby-h1')).toBeVisible();

    await adminPage.goto('/admin/economy?tab=phong');
    const panel = adminPage.locator('[data-adp-economy="phong"]');
    const row = panel.locator('tbody tr', { hasText: room.roomCode });
    await expect(row).toBeVisible();
    await shot(adminPage, '20-phong-choi');
    await row.getByRole('button', { name: 'Đóng phòng' }).click();
    await answer(adminPage, 'Phòng rác');
    await expect(panel.getByText(room.roomCode)).toHaveCount(0);
    await expect(playerPage.getByText('Phòng này đã kết thúc')).toBeVisible();
    await shot(playerPage, '21-nguoi-choi-thay-phong-da-dong');
  });

  await test.step('đóng ván đang chơi: bị bỏ dở, không ai nhận thưởng, cả hai màn hình được báo', async () => {
    const room = await call(api, 'POST', '/api/rooms', a.token, { caseId: PIXEL_CASE, visibility: 'PRIVATE' });
    await call(api, 'POST', '/api/rooms/join', b.token, { roomCode: room.roomCode });
    await call(api, 'POST', `/api/rooms/${room.roomId}/select-role`, a.token, { role: 'INVESTIGATOR' });
    await call(api, 'POST', `/api/rooms/${room.roomId}/select-role`, b.token, { role: 'INTERROGATOR' });
    await call(api, 'POST', `/api/rooms/${room.roomId}/ready`, a.token, { isReady: true });
    await call(api, 'POST', `/api/rooms/${room.roomId}/ready`, b.token, { isReady: true });
    await call(api, 'POST', `/api/rooms/${room.roomId}/start`, a.token);
    const walletBefore = (await call(api, 'GET', '/api/market/me', a.token)).balance;
    await playerPage.goto(`/game/${room.roomId}`);
    await expect(playerPage.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

    // Already on this address, where going to it again would not read the list anew.
    await adminPage.goto('/admin/economy?tab=phong');
    await adminPage.reload();
    const row = adminPage.locator('[data-adp-economy="phong"] tbody tr', { hasText: room.roomCode });
    await expect(row).toContainText('Đang chơi');
    await row.getByRole('button', { name: 'Đóng phòng' }).click();
    await answer(adminPage, 'Phòng treo sau sự cố');
    await expect(dialog(adminPage)).toHaveCount(0);

    await expect(playerPage.getByRole('heading', { name: 'Phòng đã kết thúc' })).toBeVisible({ timeout: 20_000 });
    await shot(playerPage, '22-van-dang-choi-bi-dong');
    expect((await call(api, 'GET', `/api/rooms/${room.roomId}`, b.token)).status).toBe('ABANDONED');
    expect((await call(api, 'GET', '/api/market/me', a.token)).balance).toBe(walletBefore);
  });

  await test.step('ẩn đánh giá: người chơi không còn thấy', async () => {
    const reviewId = `${Date.now().toString(16)}${'a'.repeat(16)}`.slice(0, 24);
    const { ObjectId } = await import('mongodb' as string);
    await db.collection('reviews').insertOne({
      _id: new ObjectId(reviewId), caseId: PIXEL_CASE, userId: b.user.userId, authorDisplay: nameB, rating: 1, reviewText: `Lời lẽ vi phạm ${run}`,
      containsSpoiler: false, resultLabel: 'SOLVED', createdAt: new Date(), updatedAt: new Date(),
    });
    const visible = async () => (await (await api.get(`/api/workshop/cases/${PIXEL_CASE}/reviews?pageSize=50`)).json()).data.items.some((item: { id: string }) => item.id === reviewId);
    expect(await visible()).toBe(true);

    await adminPage.goto('/admin/economy?tab=danhgia');
    const row = adminPage.locator('[data-adp-economy="danhgia"] tbody tr', { hasText: `Lời lẽ vi phạm ${run}` });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Ẩn' }).click();
    await answer(adminPage, 'Ngôn từ xúc phạm');
    await expect(row).toContainText('Đang ẩn');
    await shot(adminPage, '23-danh-gia-da-an');
    expect(await visible()).toBe(false);
  });

  await test.step('ép đăng xuất: token cũ hết hiệu lực, trang người chơi về đăng nhập', async () => {
    await adminPage.goto(`/admin/players/${a.user.userId}`);
    await adminPage.getByRole('button', { name: 'Ép đăng xuất' }).click();
    await answer(adminPage, 'Tài khoản bị lộ');
    await expect(dialog(adminPage)).toHaveCount(0);
    expect((await api.get('/api/market/me', { headers: { Authorization: `Bearer ${a.token}` } })).status()).toBe(401);
    expect((await api.post('/api/auth/refresh', { data: { refreshToken: a.refreshToken } })).ok()).toBe(false);
    await playerPage.goto('/market');
    await expect(playerPage).toHaveURL(/\/login/, { timeout: 20_000 });
    await shot(playerPage, '24-nguoi-choi-bi-ep-dang-xuat');
  });

  await test.step('khóa và mở khóa bằng API cũ, có nhật ký', async () => {
    await adminPage.goto('/admin/players');
    await adminPage.getByRole('searchbox', { name: 'Tìm người chơi' }).fill(`Bình ${run}`);
    await adminPage.getByRole('button', { name: 'Tìm', exact: true }).click();
    await adminPage.getByRole('button', { name: `Khóa ${nameB}` }).click();
    await answer(adminPage, 'Gian lận');
    await expect(adminPage.getByRole('button', { name: `Mở khóa ${nameB}` })).toBeVisible();
    await adminPage.getByRole('button', { name: `Mở khóa ${nameB}` }).click();
    await answer(adminPage, 'Khóa nhầm');
    await expect(adminPage.getByRole('button', { name: `Khóa ${nameB}` })).toBeVisible();
  });

  await test.step('nhật ký: mọi thao tác đều có, lọc được, xem được trước và sau', async () => {
    await adminPage.goto('/admin/audit');
    await expect(adminPage.locator('[data-adp-audit] tbody tr').first()).toBeVisible();
    const form = adminPage.locator('[data-adp-audit-filter]');
    await form.getByLabel('Thao tác').fill('player.coins');
    await form.getByLabel('Mã đối tượng').fill(a.user.userId);
    await form.getByRole('button', { name: 'Lọc' }).click();
    // Earlier runs against this database also left an entry, until the filter's answer arrives.
    const row = adminPage.locator('[data-adp-audit] tbody tr', { hasText: 'Bù lỗi sự kiện' });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Xem chi tiết' }).click();
    const balance = adminPage.locator('[data-adp-diff] tr', { hasText: 'balance' });
    await expect(balance).toHaveClass(/is-changed/);
    await expect(balance).toContainText('500');
    await expect(balance).toContainText('750');
    await shot(adminPage, '25-nhat-ky-so-sanh-truoc-sau');

    const log = await call<{ items: Array<{ action: string; reason: string }> }>(api, 'GET', '/api/admin/audit?pageSize=200', admin.token);
    const actions = new Set(log.items.map((entry) => entry.action));
    for (const action of ['player.coins', 'player.grant', 'player.revoke', 'player.progress', 'player.avatar.remove', 'listing.remove', 'order.cancel', 'economy.recover', 'room.close', 'review.hide', 'player.logout', 'player.lock', 'player.unlock']) {
      expect(actions, `audit is missing ${action}`).toContain(action);
    }
    const text = JSON.stringify(log.items);
    expect(text).not.toMatch(/passwordHash|refreshToken|verificationToken/i);

    await adminPage.goto(`/admin/players/${a.user.userId}?tab=nhatky`);
    const related = adminPage.locator('[data-adp-panel="nhatky"]');
    await expect(related.getByText('Bù lỗi sự kiện')).toBeVisible();
    await expect(related.getByText('Giá bất thường')).toBeVisible();
    await shot(adminPage, '26-nhat-ky-cua-nguoi-choi');
  });

  await test.step('màn điện thoại 390×844', async () => {
    const { page: phone, context } = await openAs(browser, admin, failures, { width: 390, height: 844 });
    const pages: [string, string][] = [
      ['/admin', '27-dt-tong-quan'],
      ['/admin/players', '28-dt-danh-sach'],
      ['/admin/players?tab=anh', '29-dt-duyet-anh'],
      [`/admin/players/${b.user.userId}`, '30-dt-chi-tiet'],
      ['/admin/economy', '31-dt-kinh-te'],
      ['/admin/economy?tab=cho', '32-dt-cho'],
      ['/admin/economy?tab=batthuong', '33-dt-bat-thuong'],
      ['/admin/economy?tab=ket', '34-dt-ket'],
      ['/admin/economy?tab=phong', '35-dt-phong'],
      ['/admin/economy?tab=danhgia', '36-dt-danh-gia'],
      ['/admin/audit', '37-dt-nhat-ky'],
    ];
    for (const [hash, name] of pages) {
      await phone.goto(hash);
      await phone.reload();
      await expect(phone.locator('#app .page').first()).toBeVisible();
      await expect.poll(() => phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { timeout: 10_000, message: `${hash} overflows sideways` }).toBeLessThanOrEqual(0);
      await shot(phone, name);
    }
    await phone.goto(`/admin/players/${b.user.userId}`);
    await phone.getByRole('button', { name: 'Cộng / trừ xu' }).click();
    await shot(phone, '38-dt-hop-xac-nhan');
    await context.close();
  });

  expect(failures, failures.join('\n')).toEqual([]);
});
