import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Chợ đồ end to end with two real detectives against a running API (Development, loopback Mongo):
 *   1. Minh lists a starter item, Vy buys it: inventories swap the item, Vy pays the price,
 *      Minh receives the price minus the 5% fee.
 *   2. Minh sends Vy a trade offer (item + coins for one of Vy's items); Vy accepts it.
 *
 *   SIRLOCKED_RUN_MARKET_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://localhost:5302 \
 *   SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5402 SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 \
 *   npx playwright test tests/market-full-stack.spec.ts
 *
 * The API must run with Auth__AutoVerifyRegistrations=true. Each run registers two fresh users.
 */
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string; fullName: string } };
type Wallet = { balance: number; held: number; itemCount: number; slotsUsed: number };
type InventoryItem = { itemId: string; locked: boolean; def: { id: string; name: string } };

const enabled = process.env.SIRLOCKED_RUN_MARKET_FULL_STACK === 'true';
const fee = (price: number) => Math.max(1, Math.floor((price * 5 + 50) / 100));

test('two detectives: list → buy with the 5% fee, then an accepted trade offer', async ({ browser }, testInfo) => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_MARKET_FULL_STACK=true against a running loopback API.');
  test.setTimeout(180_000);
  const api = await request.newContext({ baseURL: process.env.SIRLOCKED_TEST_API_URL });
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const minh = await register(api, `Thám tử Minh ${run}`, `minh.${run}@tests.invalid`);
  const vy = await register(api, `Thám tử Vy ${run}`, `vy.${run}@tests.invalid`);
  const seller = await openAs(browser, minh, '/market/sell');
  const buyer = await openAs(browser, vy, '/market');
  const failures: string[] = [];
  for (const page of [seller, buyer]) page.on('pageerror', (error) => failures.push(error.message));
  const price = 200 + Math.floor(Math.random() * 300);

  // Both detectives got the one-time starter grant.
  await expect(seller.locator('[data-mk-balance]')).toHaveText('500');
  await expect(buyer.locator('#nav-wallet')).toContainText('500');

  // ---- 1. Minh lists "Kính lúp Đồng thau" at a unique price.
  await seller.locator('#mk-grid').getByRole('button', { name: /Kính lúp Đồng thau/ }).click();
  await expect(seller.locator('#mk-sellpanel')).toContainText('Kính lúp Đồng thau');
  await seller.locator('#mk-price').fill(String(price));
  await expect(seller.locator('#mk-fee')).toHaveText(String(fee(price)));
  await expect(seller.locator('#mk-receive')).toHaveText(fmt(price - fee(price)));
  await seller.getByRole('button', { name: 'ĐĂNG BÁN' }).click();
  await expect(seller.locator('#toast-root')).toContainText(`Đã đăng bán với giá ${fmt(price)} xu.`);
  await expect(seller.locator('#mk-grid').getByRole('button', { name: /Kính lúp Đồng thau/ })).toContainText('ĐANG RAO');
  await shot(seller, testInfo, '01-seller-listed');

  // ---- Vy finds it on the MUA tab and buys exactly that listing.
  await buyer.locator('#mk-q').fill('kinh lup dong');
  await buyer.locator('#mk-rows').getByRole('button', { name: /Kính lúp Đồng thau/ }).click();
  const buyButton = buyer.locator('#mk-detail').getByRole('button', { name: `Mua ${fmt(price)} xu` });
  await expect(buyButton).toBeVisible();
  await shot(buyer, testInfo, '02-buyer-detail');
  await buyButton.click();
  await expect(buyer.locator('#toast-root')).toContainText(`Đã mua Kính lúp Đồng thau với giá ${fmt(price)} xu.`);
  await expect(buyer.locator('[data-mk-balance]')).toHaveText(fmt(500 - price));
  await expect(buyer.locator('#nav-wallet')).toContainText(fmt(500 - price));

  // Balances, inventories and the fee, from the server's point of view.
  const sellerWallet = await call<Wallet>(api, 'GET', '/api/market/me', minh.token);
  const buyerWallet = await call<Wallet>(api, 'GET', '/api/market/me', vy.token);
  expect(sellerWallet.balance).toBe(500 + price - fee(price));
  expect(sellerWallet.itemCount).toBe(2);
  expect(buyerWallet.balance).toBe(500 - price);
  expect(buyerWallet.itemCount).toBe(4);
  const buyerItems = (await call<{ items: InventoryItem[] }>(api, 'GET', '/api/market/inventory', vy.token)).items;
  expect(buyerItems.filter((item) => item.def.id === 'mag_brass')).toHaveLength(2);
  const sellerHistory = (await call<{ history: Array<{ role: string; price: number; fee: number; net: number }> }>(api, 'GET', '/api/market/mine', minh.token)).history;
  expect(sellerHistory[0]).toMatchObject({ role: 'SOLD', price, fee: fee(price), net: price - fee(price) });

  // Minh sees the sale in LỆNH CỦA TÔI and the lighter bag in BÁN.
  await seller.locator('#mk-tab-orders').click();
  await expect(seller.locator('#mk-orders')).toContainText('Lịch sử giao dịch');
  await expect(seller.locator('#mk-orders tbody tr').filter({ hasText: 'Kính lúp Đồng thau' }).first()).toContainText(`+${fmt(price - fee(price))} xu`);
  await expect(seller.locator('[data-mk-balance]')).toHaveText(fmt(500 + price - fee(price)));
  await shot(seller, testInfo, '03-seller-history');

  // ---- 2. Minh offers "Ghim sắt văn phòng" (+ 20 xu only while Market:TradeCoins is on) for Vy's "Bìa hồ sơ giấy kraft".
  const tradeCoins = (await call<{ coinsAllowed?: boolean }>(api, 'GET', '/api/market/trades', minh.token)).coinsAllowed === false ? 0 : 20;
  const note = tradeCoins ? 'Đổi bộ ghim + 20 xu lấy bìa hồ sơ của bạn nhé?' : 'Đổi bộ ghim lấy bìa hồ sơ của bạn nhé?';
  await seller.locator('#mk-tab-trade').click();
  await seller.locator('#mk-to').fill(`Vy ${run}`);
  await seller.locator('#mk-to-results').getByRole('button', { name: new RegExp(`Thám tử Vy ${run}`) }).click();
  await expect(seller.locator('#mk-to-chosen')).toContainText(`Thám tử Vy ${run}`);
  await seller.getByRole('button', { name: 'Thêm vật phẩm', exact: true }).click();
  await seller.locator('#mk-picker').getByRole('button', { name: /Ghim sắt văn phòng/ }).click();
  await seller.locator('#mk-picker').getByRole('button', { name: 'Xong' }).click();
  await seller.getByRole('button', { name: 'Thêm vật phẩm muốn nhận' }).click();
  await seller.locator('#mk-picker').getByRole('button', { name: /Bìa hồ sơ giấy kraft/ }).click();
  await seller.locator('#mk-picker').getByRole('button', { name: 'Xong' }).click();
  if (tradeCoins) await seller.locator('#mk-give-coins').fill(String(tradeCoins));
  else await expect(seller.locator('#mk-give-coins')).toBeHidden();
  await seller.locator('#mk-note').fill(note);
  await shot(seller, testInfo, '04-offer-draft');
  await seller.getByRole('button', { name: 'GỬI ĐỀ NGHỊ' }).click();
  await expect(seller.locator('#toast-root')).toContainText(`Đã gửi đề nghị cho Thám tử Vy ${run}.`);
  await expect(seller.locator('#mk-offers')).toContainText(`Đang chờ Thám tử Vy ${run}`);

  // ---- Vy accepts it from the inbox.
  await buyer.locator('#mk-tab-trade').click();
  const card = buyer.locator('.bpa-mk-offer').filter({ hasText: `Thám tử Minh ${run}` });
  await expect(card).toContainText('muốn đổi với bạn');
  if (tradeCoins) await expect(card).toContainText('+ 20 xu');
  await expect(card).toContainText(note);
  await shot(buyer, testInfo, '05-buyer-inbox');
  await card.getByRole('button', { name: 'CHẤP NHẬN' }).click();
  await expect(buyer.locator('#toast-root')).toContainText('Giao dịch hoàn tất');
  await expect(buyer.locator('#mk-offers')).toContainText('Đã chấp nhận');
  await expect(buyer.locator('[data-mk-balance]')).toHaveText(fmt(500 - price + tradeCoins));

  const minhItems = (await call<{ items: InventoryItem[] }>(api, 'GET', '/api/market/inventory', minh.token)).items.map((item) => item.def.id).sort();
  const vyItems = (await call<{ items: InventoryItem[] }>(api, 'GET', '/api/market/inventory', vy.token)).items.map((item) => item.def.id).sort();
  expect(minhItems).toEqual(['folder_kraft', 'folder_kraft']);
  expect(vyItems).toEqual(['mag_brass', 'mag_brass', 'pins_iron', 'pins_iron']);
  expect((await call<Wallet>(api, 'GET', '/api/market/me', minh.token)).balance).toBe(500 + price - fee(price) - tradeCoins);
  expect((await call<Wallet>(api, 'GET', '/api/market/me', vy.token)).balance).toBe(500 - price + tradeCoins);

  await seller.reload();
  await expect(seller.locator('#mk-offers')).toContainText('Đã chấp nhận');
  await shot(buyer, testInfo, '06-buyer-accepted');
  expect(failures).toEqual([]);
});

function fmt(value: number) {
  return value.toLocaleString('vi-VN');
}

async function register(api: APIRequestContext, fullName: string, email: string): Promise<Auth> {
  // Development rate-limits registrations per IP; a distinct forwarded loopback client per user keeps reruns working.
  const response = await api.post('/api/auth/register', {
    data: { fullName, email, password: 'Market-e2e-1!' },
    headers: { 'X-Forwarded-For': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` },
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

async function openAs(browser: Browser, auth: Auth, path: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript((value) => {
    localStorage.setItem('sirlocked.token', value.token);
    localStorage.setItem('sirlocked.refreshToken', value.refreshToken);
    localStorage.setItem('sirlocked.refreshExpiry', value.refreshTokenExpiry);
    localStorage.setItem('sirlocked.user', JSON.stringify(value.user));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
  }, auth);
  await page.goto(path);
  await expect(page.locator('#mk-panel')).toBeVisible();
  return page;
}

async function shot(page: Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}
