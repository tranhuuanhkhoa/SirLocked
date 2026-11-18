import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * TRAO ĐỔI with Market:TradeCoins off: the server answers coinsAllowed=false, so the page offers items only,
 * sends no coins, and an older offer that carries coins can only be declined or countered.
 */
const def = (id: string, name: string, category: string, iconKey: string) => ({
  id, category, rarity: 'COMMON', name, nameEn: name, description: `${name}.`, descriptionEn: `${name}.`, referencePrice: 100, iconKey,
});
const MAG = def('mag_brass', 'Kính lúp Đồng thau', 'MAGNIFIER', 'magnifier');
const PINS = def('pins_iron', 'Ghim sắt văn phòng', 'PINS', 'pins');
const wallet = { balance: 500, held: 0, slotsUsed: 1, slotCap: 12, itemCount: 1, reservedSlots: 0, feePercent: 5 };
const inventory = {
  items: [{
    itemId: 'mine-mag', def: MAG, locked: false, lockReason: null, listingId: null, listingPrice: null,
    equipped: false, source: 'STARTER', acquiredAt: new Date().toISOString(),
  }],
  wallet,
  equipped: {},
};
const incoming = (toCoins: number) => ({
  offerId: 'offer-1', direction: 'INCOMING', from: { userId: 'vy', name: 'Thám tử Vy' }, to: { userId: 'me', name: 'Trade Detective' },
  fromItems: [{ itemId: 'vy-pins', def: PINS, available: true }], toItems: [{ itemId: 'mine-mag', def: MAG, available: true }],
  fromCoins: 0, toCoins, message: '', status: 'PENDING', failReason: null, parentId: null, counterId: null,
  createdAt: new Date().toISOString(), respondedAt: null,
});

const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });

async function prepare(page: Page, coinsAllowed: boolean, offers: unknown[]) {
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'trade-test-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'me', fullName: 'Trade Detective', role: 'PLAYER', isEmailVerified: true }));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    (window as any).__sirlockedNoSignalR = true;
  });
  const sent: Array<Record<string, unknown>> = [];
  // Only the API: a glob like **/api/** would also swallow the Vite modules under Client/js/api/.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => ok(route, null));
  await page.route('**/api/market/me', (route) => ok(route, wallet));
  await page.route('**/api/market/inventory', (route) => ok(route, inventory));
  await page.route('**/api/market/trades', (route) => {
    if (route.request().method() === 'POST') {
      sent.push(route.request().postDataJSON());
      return ok(route, { ...incoming(0), offerId: 'offer-new', direction: 'OUTGOING' });
    }
    return ok(route, { incoming: offers, outgoing: [], history: [], coinsAllowed });
  });
  await page.route('**/api/users/search?*', (route) => ok(route, [{ userId: 'vy', username: 'Thám tử Vy' }]));
  await page.route('**/api/market/users/vy/inventory', (route) => ok(route, {
    owner: { userId: 'vy', name: 'Thám tử Vy' },
    items: [{ ...inventory.items[0], itemId: 'vy-pins', def: PINS }],
  }));
  await page.route('**/api/market/trades/*/counter', (route) => {
    sent.push(route.request().postDataJSON());
    return ok(route, { ...incoming(0), offerId: 'offer-2', direction: 'OUTGOING' });
  });
  return sent;
}

test('with coins off the trade form has no coin fields and says items only', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page, false, []);
  await page.goto('/market/trade');

  await expect(page.locator('#mk-items-only')).toBeVisible();
  await expect(page.locator('#mk-items-only')).toContainText('không kèm xu');
  await expect(page.locator('#mk-give-coins')).toBeHidden();
  await expect(page.locator('#mk-get-coins')).toBeHidden();
  expect(errors).toEqual([]);
});

test('with coins off an old offer that carries coins cannot be accepted, only declined or countered', async ({ page }) => {
  const sent = await prepare(page, false, [incoming(50)]);
  await page.goto('/market/trade');

  const card = page.locator('.bpa-mk-offer[data-offer="offer-1"]');
  await expect(card).toContainText('Đề nghị này có xu');
  await expect(card.locator('[data-act="accept"]')).toHaveCount(0);
  await expect(card.locator('[data-act="decline"]')).toBeVisible();
  await card.locator('[data-act="counter"]').click();
  // The counter-offer starts from the items; the coins are not carried over.
  await expect(page.locator('#mk-give-coins')).toBeHidden();
  await expect(page.locator('#mk-give-coins')).toHaveValue('');
  await expect(page.locator('#mk-to-chosen')).toContainText('Thám tử Vy');
  await page.locator('#mk-trade-send').click();
  await expect(page.locator('#toast-root')).toContainText('Đã gửi phản đề nghị');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ offerItemIds: ['mine-mag'], requestItemIds: ['vy-pins'], offerCoins: 0, requestCoins: 0 });
});

test('with coins off an items-only offer can still be accepted', async ({ page }) => {
  await prepare(page, false, [incoming(0)]);
  await page.goto('/market/trade');
  const card = page.locator('.bpa-mk-offer[data-offer="offer-1"]');
  await expect(card.locator('[data-act="accept"]')).toBeVisible();
  await expect(card).not.toContainText('Đề nghị này có xu');
});

test('with coins on the coin fields come back', async ({ page }) => {
  await prepare(page, true, [incoming(50)]);
  await page.goto('/market/trade');
  await expect(page.locator('#mk-give-coins')).toBeVisible();
  await expect(page.locator('#mk-get-coins')).toBeVisible();
  await expect(page.locator('#mk-items-only')).toBeHidden();
  await expect(page.locator('.bpa-mk-offer[data-offer="offer-1"] [data-act="accept"]')).toBeVisible();
});
