import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * BÁN tab with the server's growing bag (Market:BagGrows): the wallet reports the growing bag's ceiling as slotCap,
 * so the bag shows at least 12 cells, one cell per item past that, and no "x/12" count.
 */
const def = (id: string, name: string, category: string) => ({
  id, category, rarity: 'COMMON', name, nameEn: name, description: `${name}.`, descriptionEn: `${name}.`, referencePrice: 100, iconKey: null,
});
const item = (n: number) => ({
  itemId: `item-${n}`, def: def(`curio_${n}`, `Đồ sưu tầm ${n}`, 'CURIO'), locked: false, lockReason: null, listingId: null,
  listingPrice: null, equipped: false, source: 'GRANT', acquiredAt: new Date().toISOString(),
});

const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });

async function openBag(page: Page, count: number, slotCap: number) {
  const wallet = { balance: 500, held: 0, slotsUsed: count, slotCap, itemCount: count, reservedSlots: 0, feePercent: 5 };
  const inventory = { items: Array.from({ length: count }, (_, n) => item(n + 1)), wallet, equipped: {} };
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'bag-test-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'me', fullName: 'Bag Detective', role: 'PLAYER', isEmailVerified: true }));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    (window as any).__sirlockedNoSignalR = true;
  });
  // Only the API: a glob like **/api/** would also swallow the Vite modules under Client/js/api/.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => ok(route, null));
  await page.route('**/api/market/me', (route) => ok(route, wallet));
  await page.route('**/api/market/inventory', (route) => ok(route, inventory));
  await page.goto('/market/sell');
  await expect(page.locator('#mk-grid .bpa-mk-inv')).toHaveCount(count);
}

test('a growing bag holds 20 items without empty cells and says it grows', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openBag(page, 20, 500);

  await expect(page.locator('#mk-grid .bpa-mk-slot')).toHaveCount(0);
  await expect(page.locator('#mk-bag-count')).toContainText('20 ô đã dùng');
  await expect(page.locator('#mk-bag-count')).toContainText('túi tự nới thêm khi có đồ mới');
  await expect(page.locator('#mk-bag-count')).not.toContainText('/12');
  expect(errors).toEqual([]);
});

test('a growing bag with few items still shows 12 cells', async ({ page }) => {
  await openBag(page, 5, 500);

  await expect(page.locator('#mk-grid .bpa-mk-slot')).toHaveCount(7);
});

test('a fixed bag keeps the x/12 count', async ({ page }) => {
  await openBag(page, 5, 12);

  await expect(page.locator('#mk-grid .bpa-mk-slot')).toHaveCount(7);
  await expect(page.locator('#mk-bag-count')).toContainText('5/12');
  await expect(page.locator('#mk-bag-count')).not.toContainText('túi tự nới');
});
