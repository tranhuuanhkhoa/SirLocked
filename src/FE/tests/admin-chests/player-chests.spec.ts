import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * What /kho-ruong must do now that chests come from the admin: every chest has its own odds and look, none are written
 * into the page, a chest switched off still opens for whoever holds one, and a price that moved is not charged.
 */
const def = (id: string, name: string, rarity: string, iconKey: string | null, extra: Record<string, unknown> = {}) => ({
  id, category: 'CURIO', rarity, name, nameEn: name, description: `${name}.`, descriptionEn: `${name}.`, referencePrice: 100, iconKey, ...extra,
});
const NOTEBOOK = def('VC-0388', 'Sổ tay da bò', 'COMMON', 'notebook');
const LANTERN = def('VC-0391', 'Đèn bão', 'RARE', 'lantern');
const wallet = { balance: 1000, held: 0, slotsUsed: 5, slotCap: 12, itemCount: 5, reservedSlots: 0, feePercent: 5 };

const chest = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, keyDefId: id.replace('chest', 'key'), name, nameEn: name, subtitle: 'Phụ đề', subtitleEn: 'Subtitle', keyName: `chìa ${name}`, keyNameEn: 'key',
  iconKey: 'chest_seal', keyIconKey: 'key_loupe', chestPrice: 120, keyPrice: 180, chestCount: 0, keyCount: 0, contents: [NOTEBOOK, LANTERN],
  look: { template: 'seal', light: '240,164,58', hi: '255,222,150', core: '255,236,190' },
  odds: [{ rarity: 'COMMON', percent: 80 }, { rarity: 'RARE', percent: 20 }, { rarity: 'EPIC', percent: 0 }],
  active: true,
  ...extra,
});

const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });

async function prepare(page: Page, list: Record<string, unknown>, routes: Record<string, (route: Route) => unknown> = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'chest-test-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'p1', fullName: 'Thám tử', role: 'PLAYER', isEmailVerified: true }));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    (window as any).__sirlockedNoSignalR = true;
  });
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const path = new URL(route.request().url()).pathname;
    if (routes[path]) return routes[path](route);
    if (path === '/api/chests') return ok(route, list);
    return ok(route, null);
  });
}

test('each chest shows its own odds, and a rarity with no chance is left out', async ({ page }) => {
  await prepare(page, {
    chests: [
      chest('chest_a', 'Hòm A'),
      chest('chest_b', 'Hòm B', { odds: [{ rarity: 'COMMON', percent: 50 }, { rarity: 'RARE', percent: 50 }] }),
    ],
    odds: [{ rarity: 'COMMON', percent: 99 }],
    offSale: [],
    wallet,
  });
  await page.goto('/kho-ruong');

  await page.locator('#qh-oddsBtn').click();
  await expect(page.locator('#qh-odds')).toContainText('80,00%');
  await expect(page.locator('#qh-odds li')).toHaveCount(2);
  await page.locator('#qh-nextBtn').click();
  await expect(page.locator('#qh-caseName')).toHaveText('Hòm B');
  await expect(page.locator('#qh-odds')).toContainText('50,00%');
});

test('a list without per-chest odds still shows the shared table', async ({ page }) => {
  const { odds: _odds, look: _look, active: _active, ...old } = chest('chest_a', 'Hòm A');
  await prepare(page, { chests: [old], odds: [{ rarity: 'COMMON', percent: 99 }, { rarity: 'RARE', percent: 1 }], wallet });
  await page.goto('/kho-ruong');

  await page.locator('#qh-oddsBtn').click();
  await expect(page.locator('#qh-odds')).toContainText('99,00%');
});

test('any number of chests works, with the look the admin chose', async ({ page }) => {
  await prepare(page, {
    chests: [
      chest('chest_a', 'Hòm A'),
      chest('chest_b', 'Hòm B'),
      chest('chest_c', 'Hòm C'),
      chest('chest_001', 'Két Mùa Đông', { iconKey: 'chest_bank', keyIconKey: 'key_gear', look: { template: 'bank', light: '1,2,3', hi: '4,5,6', core: '7,8,9' } }),
    ],
    odds: [],
    offSale: [],
    wallet,
  });
  await page.goto('/kho-ruong');

  await expect(page.locator('.qh-dot')).toHaveCount(4);
  await page.locator('.qh-dot').nth(3).click();
  await expect(page.locator('#qh-caseName')).toHaveText('Két Mùa Đông');
  await expect.poll(() => page.locator('.qh-app').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--glow'))).toBe('rgb(1,2,3)');
});

test('with nothing on sale the page says so instead of breaking', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page, { chests: [], odds: [], offSale: [], wallet });
  await page.goto('/kho-ruong');

  await expect(page.locator('#qh-empty')).toContainText('Chưa có hòm');
  expect(errors).toEqual([]);
});

test('a chest switched off that the player holds appears, can be opened and offers nothing to buy', async ({ page }) => {
  let opened = 0;
  await prepare(page, {
    chests: [chest('chest_a', 'Hòm A')],
    odds: [],
    offSale: [chest('chest_off', 'Hòm Cũ', { chestCount: 1, keyCount: 1, active: false })],
    wallet,
  }, {
    '/api/chests/chest_off/open': (route) => {
      opened += 1;
      return ok(route, { chestId: 'chest_off', itemId: 'i1', item: NOTEBOOK, chestCount: 0, keyCount: 0, wallet });
    },
  });
  await page.goto('/kho-ruong');

  await page.locator('#qh-nextBtn').click();
  await expect(page.locator('#qh-caseName')).toHaveText('Hòm Cũ');
  await expect(page.locator('[data-qh-buy]').first()).toBeHidden();
  await expect(page.locator('#qh-openLbl')).toHaveText('Mở');
  await page.locator('#qh-openBtn').click();
  await expect(page.locator('#qh-gotName')).toHaveText('Sổ tay da bò', { timeout: 20_000 });
  expect(opened).toBe(1);
  await page.locator('#qh-keepBtn').click();

  // Nothing left of it, and it cannot be bought back.
  await expect(page.locator('#qh-openBtn')).toBeDisabled();
  await expect(page.locator('#qh-meta')).toContainText('ngừng bán');
});

test('buying sends the price on screen, and a price that moved is explained and refreshed', async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  let price = 180;
  await prepare(page, { chests: [chest('chest_a', 'Hòm A', { chestCount: 1 })], odds: [], offSale: [], wallet }, {
    '/api/chests': (route) => ok(route, { chests: [chest('chest_a', 'Hòm A', { chestCount: 1, keyPrice: price })], odds: [], offSale: [], wallet }),
    '/api/chests/chest_a/keys': (route) => {
      bodies.push(route.request().postDataJSON());
      price = 230;
      return route.fulfill({ status: 409, json: { success: false, message: 'moved', errors: { code: 'CHEST_PRICE_CHANGED', messageKey: 'market.CHEST_PRICE_CHANGED' } } });
    },
  });
  await page.goto('/kho-ruong');

  await expect(page.locator('#qh-openLbl')).toContainText('180');
  await page.locator('#qh-openBtn').click();

  await expect(page.locator('#toast-root')).toContainText('Giá vừa thay đổi');
  await expect(page.locator('#qh-openLbl')).toContainText('230');
  expect(bodies[0].expectedPrice).toBe(180);
});

test('a chest that stopped selling while the page was open says so', async ({ page }) => {
  await prepare(page, { chests: [chest('chest_a', 'Hòm A', { chestCount: 1 }), chest('chest_b', 'Hòm B')], odds: [], offSale: [], wallet }, {
    '/api/chests/chest_a/keys': (route) => route.fulfill({ status: 409, json: { success: false, message: 'off', errors: { code: 'CHEST_NOT_FOR_SALE', messageKey: 'market.CHEST_NOT_FOR_SALE' } } }),
  });
  await page.goto('/kho-ruong');

  await page.locator('#qh-openBtn').click();

  await expect(page.locator('#toast-root')).toContainText('ngừng bán');
});

test('a curio that borrows a chest sprite draws that chest, not the fallback icon', async ({ page }) => {
  await prepare(page, {
    chests: [chest('chest_a', 'Hòm A', { contents: [def('CU-1', 'Mô hình két', 'COMMON', 'chest_bank'), def('CU-2', 'Không rõ', 'COMMON', 'khong-co-sprite-nay')] })],
    odds: [],
    offSale: [],
    wallet,
  });
  await page.goto('/kho-ruong');

  const tiles = page.locator('#qh-contents .qh-it canvas');
  await expect(tiles).toHaveCount(2);
  const [borrowed, fallback] = await tiles.evaluateAll((canvases: HTMLCanvasElement[]) => canvases.map((canvas) => canvas.toDataURL()));
  expect(borrowed).not.toBe(fallback);
});

test('an uploaded picture is what "You may get" and the reel draw', async ({ page }) => {
  // Same origin, so the test may read the pixels back. A real one comes from Cloudinary, which only draws.
  // One magenta pixel, a colour no fallback icon has.
  const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z/D/PwAG/gL+DHWJ3gAAAABJRU5ErkJggg==', 'base64');
  await page.route('**/test-art/moi.png', (route) => route.fulfill({ contentType: 'image/png', body: PIXEL_PNG }));
  const picture = def('CU-0001', 'Bức ảnh', 'COMMON', null, { visual: { iconKey: null, imageUrl: '/test-art/moi.png', builtinId: null, template: null, params: {} } });
  await prepare(page, { chests: [chest('chest_a', 'Hòm A', { contents: [picture], chestCount: 1, keyCount: 1 })], odds: [], offSale: [], wallet }, {
    '/api/chests/chest_a/open': (route) => ok(route, { chestId: 'chest_a', itemId: 'i1', item: picture, chestCount: 0, keyCount: 0, wallet }),
  });
  await page.goto('/kho-ruong');

  const tile = page.locator('#qh-contents .qh-it canvas');
  await expect(page.locator('#qh-contents .qh-it')).toContainText('Bức ảnh');
  await expect.poll(() => tile.evaluate((canvas: HTMLCanvasElement) =>
    [...canvas.getContext('2d')!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data])).toEqual([255, 0, 255, 255]);

  await page.locator('#qh-openBtn').click();
  await expect(page.locator('#qh-gotName')).toHaveText('Bức ảnh', { timeout: 20_000 });
});
