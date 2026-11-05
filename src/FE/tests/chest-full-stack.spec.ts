import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Mở hòm end to end against a running API (Development, loopback Mongo):
 *   1. an admin grants a detective chests and keys of all three types,
 *   2. the detective buys one more key and opens all three types through the page,
 *   3. every item shown by the reveal is really in the server's inventory, with Source = CHEST,
 *   4. one of them goes on sale at the market, with its pixel icon on every screen,
 *   5. the same flow fits a 390×844 phone.
 *
 *   SIRLOCKED_RUN_CHEST_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://127.0.0.1:5216 \
 *   SIRLOCKED_TEST_ADMIN_EMAIL=admin@sirlocked.local SIRLOCKED_TEST_ADMIN_PASSWORD=<local demo password> \
 *   SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5174 SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 \
 *   npx playwright test tests/chest-full-stack.spec.ts
 *
 * The API must run with Auth__AutoVerifyRegistrations=true (scripts/start-local-demo.ps1 does).
 * Set SIRLOCKED_CHEST_EVIDENCE_DIR to keep the screenshots somewhere else than the test output.
 */
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string; fullName: string } };
type Def = { id: string; name: string; rarity: string; category: string; iconKey: string };
type InventoryItem = { itemId: string; locked: boolean; lockReason: string | null; source: string; def: Def };
type Chest = { id: string; name: string; chestCount: number; keyCount: number; keyPrice: number; chestPrice: number; contents: Def[] };
type ChestList = { chests: Chest[]; odds: Array<{ rarity: string; percent: number }>; wallet: { balance: number; slotsUsed: number; itemCount: number } };

const enabled = process.env.SIRLOCKED_RUN_CHEST_FULL_STACK === 'true';
const evidenceDir = process.env.SIRLOCKED_CHEST_EVIDENCE_DIR;

test('an admin grant, a bought key, all three chest types opened, and the reward sold on the market', async ({ browser }, testInfo) => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_CHEST_FULL_STACK=true against a running loopback API.');
  test.setTimeout(420_000);
  const api = await request.newContext({ baseURL: process.env.SIRLOCKED_TEST_API_URL });
  const admin = await login(api, process.env.SIRLOCKED_TEST_ADMIN_EMAIL!, process.env.SIRLOCKED_TEST_ADMIN_PASSWORD!);
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const player = await register(api, `Thám tử Mở Hòm ${run}`, `chest.${run}@tests.invalid`);
  const shot = async (page: Page, name: string) => {
    const path = evidenceDir ? `${evidenceDir}/${name}.png` : testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path });
  };

  // ---- A player may not use the admin route; the admin can.
  const denied = await api.post('/api/chests/admin/grant', {
    headers: { Authorization: `Bearer ${player.token}` },
    data: { userId: player.user.userId, chestId: 'chest_np', chests: 1, keys: 1 },
  });
  expect(denied.status()).toBe(403);
  for (const chestId of ['chest_np', 'chest_nb', 'chest_sm']) {
    await call(api, 'POST', '/api/chests/admin/grant', admin.token, {
      userId: player.user.userId, chestId, chests: 1, keys: chestId === 'chest_np' ? 0 : 1,
    });
  }
  const before = await call<ChestList>(api, 'GET', '/api/chests', player.token);
  expect(before.chests).toHaveLength(3);
  expect(before.odds.reduce((sum, odd) => sum + odd.percent, 0)).toBeCloseTo(100, 6);
  const granted = await call<{ items: InventoryItem[] }>(api, 'GET', '/api/market/inventory', player.token);
  expect(granted.items.filter((item) => item.def.category === 'CHEST').every((item) => item.source === 'GRANT')).toBe(true);

  const failures: string[] = [];
  const page = await openAs(browser, player, { width: 1440, height: 900 }, failures);
  await expect(page.locator('#qh-caseName')).toHaveText('Hòm Niêm Phong');
  await expect(page.locator('#qh-openLbl')).toContainText('Mua chìa');
  await page.waitForTimeout(1300);
  await shot(page, '01-may-tinh-hom-niem-phong-het-chia');

  // ---- The key of the first chest is bought with coins, through the page.
  const keyPrice = before.chests[0].keyPrice;
  await page.locator('#qh-openBtn').click();
  await expect(page.locator('#qh-nKey')).toHaveText('1');
  await expect(page.locator('#qh-nCoin')).toHaveText(fmt(before.wallet.balance - keyPrice));
  await page.locator('#qh-oddsBtn').click();
  await expect(page.locator('#qh-odds')).toContainText('79,92%');
  await expect(page.locator('#qh-odds')).toContainText('0,26%');
  await page.waitForTimeout(500);
  await shot(page, '02-may-tinh-ti-le-roi-tu-api');
  await page.locator('#qh-oddsBtn').click();
  await page.waitForTimeout(500);

  // ---- Open all three types; what the reveal names is what the server stored.
  const received: string[] = [];
  for (const [index, chest] of before.chests.entries()) {
    await expect(page.locator('#qh-caseName')).toHaveText(chest.name);
    const owned = await call<{ items: InventoryItem[] }>(api, 'GET', '/api/market/inventory', player.token);
    const answer = page.waitForResponse((response) => response.url().endsWith(`/api/chests/${chest.id}/open`));
    await page.locator('#qh-openBtn').click();
    await expect(page.locator('.qh-app')).toHaveAttribute('data-mode', 'open');
    await page.waitForTimeout(700);
    await shot(page, `${pad(3 + index * 3)}-may-tinh-${chest.id}-dang-mo`);
    const body = (await (await answer).json()).data;
    await expect(page.locator('.qh-app')).toHaveAttribute('data-mode', 'spin', { timeout: 15_000 });
    await page.waitForTimeout(1500);
    await shot(page, `${pad(4 + index * 3)}-may-tinh-${chest.id}-dai-quay`);
    await expect(page.locator('.qh-app')).toHaveAttribute('data-revealed', '', { timeout: 20_000 });
    await expect(page.locator('#qh-gotName')).toHaveText(body.item.name);
    await page.waitForTimeout(1200);
    await shot(page, `${pad(5 + index * 3)}-may-tinh-${chest.id}-trung-${body.item.id}`);

    const after = await call<{ items: InventoryItem[] }>(api, 'GET', '/api/market/inventory', player.token);
    const reward = after.items.find((item) => item.itemId === body.itemId);
    expect(reward?.def.id).toBe(body.item.id);
    expect(reward?.source).toBe('CHEST');
    expect(after.items.some((item) => item.def.id === chest.id)).toBe(false);
    expect(after.items).toHaveLength(owned.items.length - 1);
    expect(chest.contents.map((def) => def.id)).toContain(body.item.id);
    received.push(body.itemId);

    await page.locator('#qh-keepBtn').click();
    await expect(page.locator('.qh-app')).toHaveAttribute('data-mode', 'idle');
    await expect(page.locator('#qh-openLbl')).toContainText('Mua hòm');
    await page.locator('#qh-nextBtn').click();
  }

  // ---- No chest or key left: the next click must not spend anything.
  const none = await call<ChestList>(api, 'GET', '/api/chests', player.token);
  expect(none.chests.every((chest) => chest.chestCount === 0 && chest.keyCount === 0)).toBe(true);

  // ---- The rewards are ordinary items: in the bag with their icon, listable, visible on the market.
  await page.goto('/market/sell');
  const firstReward = (await call<{ items: InventoryItem[] }>(api, 'GET', '/api/market/inventory', player.token))
    .items.find((item) => item.itemId === received[0])!;
  const tile = page.locator(`#mk-grid [data-item="${firstReward.itemId}"]`);
  await expect(tile.locator('img.bpa-mk-icon')).toHaveCount(1);
  await tile.click();
  await expect(page.locator('#mk-sellpanel')).toContainText(firstReward.def.name);
  await expect(page.locator('#mk-sellpanel [data-act="equip"]')).toHaveCount(0);
  const price = 4321;
  await page.locator('#mk-price').fill(String(price));
  await shot(page, '12-kho-do-vat-pham-tu-hom');
  await page.getByRole('button', { name: 'ĐĂNG BÁN' }).click();
  await expect(page.locator('#toast-root')).toContainText('Đã đăng bán');
  await expect(tile).toContainText('ĐANG RAO');

  await page.goto('/market');
  await page.locator('#mk-q').fill(firstReward.def.name);
  const row = page.locator(`#mk-rows [data-def="${firstReward.def.id}"]`);
  await expect(row).toContainText(fmt(price));
  await expect(row.locator('img.bpa-mk-icon')).toHaveCount(1);
  await row.click();
  await expect(page.locator('#mk-detail')).toContainText(fmt(price));
  await page.waitForTimeout(400);
  await shot(page, '13-cho-do-vat-pham-dang-rao');
  await page.locator('#mk-q').fill('');
  await page.locator('.bpa-mk-cat[data-category="CHEST"]').click();
  await expect(page.locator('#mk-rows [data-def="chest_nb"] img.bpa-mk-icon')).toHaveCount(1);
  await shot(page, '14-cho-do-danh-muc-hom');
  await page.locator('.bpa-mk-cat[data-category="KEY"]').click();
  await expect(page.locator('#mk-rows [data-def="key_sm"] img.bpa-mk-icon')).toHaveCount(1);
  await shot(page, '15-cho-do-danh-muc-chia');

  // ---- A phone, from buying to the reveal.
  await call(api, 'POST', '/api/chests/admin/grant', admin.token, { userId: player.user.userId, chestId: 'chest_nb', chests: 1, keys: 1 });
  const phone = await openAs(browser, player, { width: 390, height: 844 }, failures, true);
  await phone.locator('#qh-nextBtn').click();
  await expect(phone.locator('#qh-caseName')).toHaveText('Két Nhà Băng');
  await expect(phone.locator('#qh-openLbl')).toHaveText('Mở');
  await phone.waitForTimeout(600);
  await shot(phone, '16-dien-thoai-ket-nha-bang');
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await phone.locator('#qh-openBtn').click();
  await expect(phone.locator('.qh-app')).toHaveAttribute('data-mode', 'spin', { timeout: 15_000 });
  await phone.waitForTimeout(1200);
  await shot(phone, '17-dien-thoai-dai-quay');
  await expect(phone.locator('.qh-app')).toHaveAttribute('data-revealed', '', { timeout: 20_000 });
  await phone.waitForTimeout(1200);
  await shot(phone, '18-dien-thoai-trung-thuong');
  await expect(phone.locator('#qh-keepBtn')).toBeInViewport({ ratio: 1 });

  expect(failures).toEqual([]);
  await api.dispose();
});

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function fmt(value: number) {
  return Number(value).toLocaleString('vi-VN');
}

async function login(api: APIRequestContext, email: string, password: string): Promise<Auth> {
  const response = await api.post('/api/auth/login', { data: { email, password } });
  const body = await response.text();
  expect(response.ok(), `login ${email}: ${response.status()}`).toBe(true);
  return JSON.parse(body).data;
}

async function register(api: APIRequestContext, fullName: string, email: string): Promise<Auth> {
  // Development rate-limits registrations per IP; a distinct forwarded loopback client per user keeps reruns working.
  const response = await api.post('/api/auth/register', {
    data: { fullName, email, password: 'Market-e2e-1!' },
    headers: { 'X-Forwarded-For': `10.78.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` },
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

async function openAs(browser: Browser, auth: Auth, viewport: { width: number; height: number }, failures: string[], touch = false): Promise<Page> {
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
  await page.goto('/kho-ruong');
  await expect(page.locator('#qh-openBtn')).toBeVisible();
  return page;
}
